import Decimal from 'decimal.js'
import type { BarService, BarsResult, OhlcvBar } from '../market-data/bars/types.js'
import { assertFreshBars, closedBars } from './bar-policy.js'
import type { DashboardEvent, DashboardMetric, DashboardModule, DashboardSeries, DashboardSource, DashboardUnit } from './dashboard-types.js'

/** Public issuer endpoints observed on strategy.com; no account or auth calls. */
const URLS = {
  bitcoin: 'https://api.strategy.com/btc/bitcoinKpis',
  mstr: 'https://api.strategy.com/btc/mstrKpiData',
  strc: 'https://api.strategy.com/btc/strcKpiData',
} as const
const NOTES = 'https://www.strategy.com/notes'
const DAY = 86_400_000
const MNAV_VERSION = 'strategy-net-bps-2026-07-23'
type Row = Record<string, unknown>
type ReadResult<T> = { value: T | null; fetchedAt: string; error?: string }
type PublicRead = ReadResult<unknown>
interface MarketBars { bars: OhlcvBar[]; source: DashboardSource }

function row(value: unknown): Row {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

/** Missing, malformed and numeric zero are deliberately different states. */
export function strategyNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value.trim())) return null
  const number = Number(value.trim().replaceAll(',', ''))
  return Number.isFinite(number) ? number : null
}

function positive(value: unknown): number | null {
  const n = strategyNumber(value)
  return n != null && n > 0 ? n : null
}

function nonnegative(value: unknown): number | null {
  const n = strategyNumber(value)
  return n != null && n >= 0 ? n : null
}

function calendarDay(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? value : null
}

/** These specific issuer fields explicitly say UTC, even when their text omits Z. */
function issuerTime(value: Row, fallback: unknown, now: Date): string | null {
  const millis = positive(value.msTimestamp ?? value.msTimeStamp)
  const raw = value.timeStampUtc ?? fallback
  const iso = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/.test(raw)
    && calendarDay(raw.slice(0, 10)) ? `${raw.replace(/Z$/, '')}Z` : null
  const ms = millis ?? (iso ? Date.parse(iso) : NaN)
  return Number.isFinite(ms) && ms >= Date.UTC(2020, 0, 1) && ms <= now.getTime() + 300_000
    ? new Date(ms).toISOString() : null
}

function safeFailure(error: unknown): string {
  if (error instanceof IssuerReadError) return error.message
  if (error instanceof Error && /timeout|abort/i.test(error.name)) return '请求超时'
  if (error instanceof Error) {
    const status = /\bHTTP\s+(\d{3})\b/i.exec(error.message)?.[1]
    if (status) return `行情接口 HTTP ${status}`
    if (error.message.startsWith('Stale 1d bars:')) return '日线已过期'
    if (error.message.startsWith('Future 1d bar timestamp')) return '日线时间位于未来'
    if (/not configured|credentials.*missing/i.test(error.message)) return '行情凭据未配置'
  }
  // Transport messages may contain URLs or configured credential fragments.
  return '行情请求失败；原始网络响应未记录'
}
class IssuerReadError extends Error {}

function source(read: PublicRead, url: string, time: string | null, now: Date, disclosure = false): DashboardSource {
  return {
    provider: 'Strategy issuer API', url, dataAt: disclosure ? null : time, publishedAt: null, fetchedAt: read.fetchedAt,
    status: read.error || !read.value ? 'unavailable' : disclosure || !time || now.getTime() - Date.parse(time) > 4 * DAY ? 'stale' : 'ok',
    detail: read.error ?? (disclosure
      ? '发行人当前页面值；接口未提供底层披露日期。行情更新时间不能作为财务报告日期。'
      : !time ? '发行人未返回有效数据时间，不能确认新鲜度。' : '发行人市场快照；底层持币、股本和优先索偿权按最近披露更新，单项披露日期未提供。'),
  }
}

function metric(id: string, label: string, value: number | null, unit: DashboardUnit, description: string, provenance: DashboardSource): DashboardMetric {
  return { id, label, value, unit, description, source: value == null
    ? { ...provenance, status: 'unavailable', detail: provenance.status === 'unavailable' ? provenance.detail : `${provenance.detail ?? ''} 所需字段缺失或无效。`.trim() }
    : { ...provenance } }
}

function snapshotPoint(metric: DashboardMetric, group: 'strategy' | 'strc'): DashboardSeries | null {
  if (metric.value == null || !metric.source.dataAt) return null
  return { id: metric.id, label: metric.label, unit: metric.unit, group,
    points: [{ at: metric.source.dataAt, value: metric.value }], source: { ...metric.source } }
}

function company(raw: unknown, expected: 'MSTR' | 'STRC'): Row {
  return Array.isArray(raw) ? row(raw.find(x => row(x).company === expected)) : {}
}

interface Dividend { recordDate: string; payDate: string; amount: number; rate: number | null }
export function strategyDividends(raw: unknown): Dividend[] {
  if (!Array.isArray(raw)) return []
  const unique = new Map<string, Dividend>()
  for (const item of raw.slice(0, 500)) {
    const r = row(item)
    const recordDate = calendarDay(r.recordDate)
    const payDate = calendarDay(r.payDate)
    const amount = nonnegative(r.cashAmount)
    if (!recordDate || !payDate || payDate < recordDate || amount == null) continue
    const key = `${recordDate}:${payDate}`
    const existing = unique.get(key)
    // Conflicting duplicate records must not be counted twice or picked arbitrarily.
    if (existing && existing.amount !== amount) return []
    unique.set(key, { recordDate, payDate, amount, rate: nonnegative(r.rate) })
  }
  return [...unique.values()].sort((a, b) => a.payDate.localeCompare(b.payDate))
}

export function strategyIssuerModule(reads: { bitcoin: PublicRead; mstr: PublicRead; strc: PublicRead }, now: Date, days: 30 | 90 | 365): DashboardModule {
  const btcRoot = row(reads.bitcoin.value)
  const btc = row(btcRoot.results)
  const mstr = company(reads.mstr.value, 'MSTR')
  const strc = company(reads.strc.value, 'STRC')
  const btcAt = issuerTime(btc, btcRoot.timestamp, now)
  const mstrAt = issuerTime(mstr, undefined, now)
  const strcAt = issuerTime(strc, undefined, now)
  const btcSource = source(reads.bitcoin, URLS.bitcoin, btcAt, now)
  const disclosed = source(reads.bitcoin, URLS.bitcoin, btcAt, now, true)
  const mstrSource = source(reads.mstr, URLS.mstr, mstrAt, now)
  const capitalSource = source(reads.mstr, URLS.mstr, mstrAt, now, true)
  const strcSource = source(reads.strc, URLS.strc, strcAt, now)
  const strcDisclosure = source(reads.strc, URLS.strc, strcAt, now, true)
  const netBps = strategyNumber(btc.netBtcPerShareUsd)
  const grossSats = positive(btc.satsPerShare)
  const holdings = nonnegative(btc.btcHoldings)
  const price = positive(strc.ufPrice ?? strc.price)
  const rate = nonnegative(strc.currentDividend)
  const annualObligations = nonnegative(btc.totalAnnualDividends)
  const mnav = btcAt && btcAt >= '2026-07-23' && netBps != null && netBps > 0 ? positive(btc.mNav) : null
  const mnavSource = { ...btcSource, formula: 'MSTR 市场价 ÷ Net Bitcoin Per Share (USD)。使用发行人同一快照的 mNAV，未混入另一时点的股价。', formulaVersion: MNAV_VERSION }
  const effectiveYield = rate != null && price != null ? new Decimal(rate).div(price).mul(100).toNumber() : null
  const dollars = (v: unknown) => { const n = nonnegative(v); return n == null ? null : new Decimal(n).mul(1_000_000).toNumber() }
  const metrics: DashboardMetric[] = [
    metric('mstr-price', 'MSTR 最新价', positive(mstr.ufPrice ?? mstr.price), 'usd', '发行人行情快照，独立于下方已收盘的历史行情。', mstrSource),
    metric('strategy-mnav', '官方 mNAV', mnav, 'ratio', '2026-07-23 起采用每股净比特币价值口径；此前口径不可直接比较。', mnavSource),
    metric('strategy-btc-holdings', '公司持有 BTC', holdings, 'btc', '发行人当前披露的持币数量；报告期日期未由此接口提供。', disclosed),
    metric('strategy-gross-bps', '每股含币量（毛额）', grossSats, 'sats', 'BTC holdings ÷ Assumed Diluted Shares Outstanding；未扣除债务和优先股。', { ...disclosed, formula: '持有 BTC × 100,000,000 ÷ 假设摊薄股数', formulaVersion: 'issuer-assumed-diluted-bps-v1' }),
    metric('strategy-net-bps', '每股含币量（净额）', strategyNumber(btc.netSatsPerShare), 'sats', '扣除特定优先索偿权并抵减美元资产；分母为 Fully Diluted Shares Outstanding，与毛额分母不同。', { ...btcSource, formulaVersion: MNAV_VERSION }),
    metric('strategy-net-bps-usd', '每股净比特币价值', netBps, 'usd', '发行人净每股含币量按其 BTC 价格换算；不等同清算可收回金额。', { ...btcSource, formulaVersion: MNAV_VERSION }),
    metric('strategy-assumed-shares-estimate', '假设摊薄股数（反推估算）', holdings != null && grossSats != null ? new Decimal(holdings).mul(100_000_000).div(grossSats).toDecimalPlaces(0).toNumber() : null, 'count', '按已展示的持币量和每股含币量反推，取整且受四舍五入影响；不是独立股本披露，也不是 Fully Diluted 股数。', { ...disclosed, formula: '持有 BTC × 100,000,000 ÷ 每股含币量（聪）', formulaVersion: 'implied-adso-v1' }),
    metric('strategy-debt', '可转换债务本金', dollars(mstr.debt), 'usd', '发行人接口以百万美元提供，已换算为美元；不等同本期到期现金支出。', capitalSource),
    metric('strategy-preferred', '优先股名义金额', dollars(mstr.pref), 'usd', '发行人汇总优先股名义金额，已由百万美元换算；不等同清算时最终索偿额。', capitalSource),
    metric('strategy-annual-obligations', '年化利息与股息', annualObligations, 'usd', '发行人当前年化利息及优先股股息口径；不是仅 STRC 股息，也不是全部经营现金支出。', disclosed),
    metric('strategy-usd-coverage', '美元支付覆盖（发行人模型，月）', annualObligations != null && annualObligations > 0 ? nonnegative(btc.usdMonthsOfDividends) : null, 'months', '发行人美元资产 ÷ 当前全部年化债务利息与优先股股息 × 12；恒定支出假设，不含经营支出及到期本金，不是仅 STRC 覆盖或存续期预测。', { ...disclosed, formula: '发行人 USD Assets ÷ Annual Int + Div × 12', formulaVersion: 'issuer-usd-duration-v1' }),
    metric('strategy-usd-reserve', '指定美元储备', null, 'usd', '公开结构化接口未提供独立 USD Reserve 字段及其披露日期；不与其他现金项目盲目相加。', { ...disclosed, status: 'unavailable', detail: '当前接口未提供独立储备值；没有用总储备、股息覆盖或现金余额代替。', url: NOTES }),
    metric('strc-price', 'STRC 最新价', price, 'usd', '浮动股息永续优先股；100 美元为约定金额参考，不保证到期或随时按此价格回本。', strcSource),
    metric('strc-dividend-rate', 'STRC 当前年化股息率', rate, 'percent', '按每股 100 美元约定金额计算，利率可调整；以董事会宣告和有效条款为准。', strcDisclosure),
    metric('strc-current-yield', 'STRC 当前简单收益率', effectiveYield, 'percent', '当前年化每股股息 ÷ 最新市场价；未计复投、价格变化及税费，不是持有期总回报。', { ...strcSource, formula: '(当前股息率 ÷ 100 × $100) ÷ STRC 市价 × 100', formulaVersion: 'strc-simple-current-yield-v1' }),
    metric('strc-notional', 'STRC 名义金额', nonnegative(strc.notional), 'usd', '单独的 STRC 发行在外名义金额，接口未提供底层披露日期。', strcDisclosure),
  ]
  const cutoff = new Date(now.getTime() - days * DAY).toISOString().slice(0, 10)
  const today = now.toISOString().slice(0, 10)
  const forward = new Date(now.getTime() + 45 * DAY).toISOString().slice(0, 10)
  const dividends = strategyDividends(strc.dividendHistory)
  const events: DashboardEvent[] = dividends.filter(d => d.payDate >= cutoff && d.payDate <= forward).map(d => ({
    id: `strc-dividend-${d.recordDate}-${d.payDate}`, at: d.payDate, availableAt: reads.strc.fetchedAt,
    label: `STRC ${d.payDate > today ? '计划派息' : '派息日历'} $${d.amount}/股`, kind: 'dividend', url: 'https://www.strategy.com/strc',
    detail: `登记日 ${d.recordDate}；${d.rate == null ? '年化股息率未提供' : `对应年化股息率 ${d.rate}%`}。日期及金额来自发行人日历，未来派息取决于有效宣告；未核验逐笔到账。`,
  }))
  const nextPayout = calendarDay(strc.nextPayoutDate)
  const nextRecord = calendarDay(strc.nextRecordDate)
  if (nextPayout && nextPayout >= today && nextPayout <= forward && (!nextRecord || nextRecord <= nextPayout) && !events.some(e => e.at === nextPayout)) {
    events.push({ id: `strc-next-${nextPayout}`, at: nextPayout, availableAt: reads.strc.fetchedAt, label: 'STRC 下一计划派息日', kind: 'dividend', url: 'https://www.strategy.com/strc', detail: `登记日 ${nextRecord ?? '未提供'}；需以董事会宣告为准。` })
  }
  const series = metrics.filter(m => ['strategy-mnav', 'strategy-net-bps', 'strategy-net-bps-usd', 'strc-price'].includes(m.id))
    .map(m => snapshotPoint(m, m.id.startsWith('strc') ? 'strc' : 'strategy')).filter((s): s is DashboardSeries => s != null)
  const paid = dividends.filter(d => d.payDate >= cutoff && d.payDate <= today)
  if (paid.length) series.push({ id: 'strc-dividend-calendar', label: 'STRC 日历每次派息金额（每股）', unit: 'usd', group: 'strc',
    points: paid.map(d => ({ at: d.payDate, value: d.amount })), source: { ...strcDisclosure, dataAt: paid.at(-1)!.payDate,
      detail: '发行人历史派息日历；观察日为本次获取时间，非事前可用历史。没有除息日，不据此合成总回报。' } })
  const rates = dividends.filter(d => d.recordDate >= cutoff && d.recordDate <= today && d.rate != null)
  if (rates.length) series.push({ id: 'strc-dividend-rate-history', label: 'STRC 登记日对应年化股息率', unit: 'percent', group: 'strc',
    points: rates.map(d => ({ at: d.recordDate, value: d.rate! })), source: { ...strcDisclosure, dataAt: rates.at(-1)!.recordDate,
      detail: '按发行人日历的登记日展示对应期年化股息率；登记日不是最初公告日。仅作历史资料，不用于事前判断评分。' } })
  return { id: 'strategy', label: 'Strategy · MSTR / STRC', metrics, series, events, notes: [
    '公司数据直接来自 Strategy 官方接口。持币、股本和现金支出字段缺独立披露日期时保留日期未知，不将实时行情时间标作报告日期。',
    'mNAV 使用 2026-07-23 起的发行人净每股含币量定义；不会拼接之前的企业价值口径。净含币量和毛含币量使用不同摊薄股数。',
    '美元覆盖月数是发行人模型值，未另加美元储备或现金，避免重复计算；不能据此推断违约概率。',
    'STRC 单独展示优先股价格与派息。历史价格变化未计股息；缺少完整除息与调整记录时不合成总回报。',
    '新增资料只用于研究与留档，不自动改变威科夫规则、方向分数或交易行为。',
  ] }
}

export function createStrategyDashboard(options: { barService: BarService; fetcher?: typeof fetch; now?: () => Date }) {
  const fetcher = options.fetcher ?? fetch
  const now = options.now ?? (() => new Date())
  const cache = new Map<string, { expires: number; data: PublicRead }>()
  const active = new Map<string, Promise<PublicRead>>()
  const reports = new Map<number, { expires: number; module: DashboardModule }>()
  const running = new Map<number, Promise<DashboardModule>>()
  async function readJson(url: string): Promise<PublicRead> {
    const cached = cache.get(url)
    if (cached && cached.expires > now().getTime()) return cached.data
    const pending = active.get(url)
    if (pending) return pending
    const task = (async () => {
      const fetchedAt = now().toISOString()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 8_000)
      let data: PublicRead
      try {
        const response = await fetcher(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } })
        if (!response.ok) throw new IssuerReadError(`官方接口 HTTP ${response.status}`)
        let json: unknown
        try { json = await response.json() } catch { throw new IssuerReadError('官方接口返回无效 JSON') }
        const valid = url === URLS.bitcoin ? Object.keys(row(row(json).results)).length > 0
          : Object.keys(company(json, url === URLS.mstr ? 'MSTR' : 'STRC')).length > 0
        if (!valid) throw new IssuerReadError('官方接口响应结构或证券身份不匹配')
        data = { value: json, fetchedAt }
      } catch (error) { data = { value: null, fetchedAt, error: controller.signal.aborted ? '官方接口请求超时' : safeFailure(error) } }
      finally { clearTimeout(timer) }
      cache.set(url, { expires: now().getTime() + (data.error ? 60_000 : 300_000), data })
      return data
    })()
    active.set(url, task)
    try { return await task } finally { active.delete(url) }
  }
  async function bars(symbol: 'MSTR' | 'STRC' | 'BTC-USD', days: number, at: Date): Promise<MarketBars> {
    const crypto = symbol === 'BTC-USD'
    const providers = crypto ? ['coinbase', 'yfinance'] : ['alpaca', 'yfinance']
    const failures: string[] = []
    for (const provider of providers) {
      try {
        const result: BarsResult = await options.barService.getBars({ barId: `${provider}|${symbol}`, assetClass: crypto ? 'crypto' : 'equity' }, {
          interval: '1d', start: new Date(at.getTime() - days * DAY).toISOString().slice(0, 10), end: at.toISOString().slice(0, 10), count: days + 1,
        })
        const from = new Date(at.getTime() - days * DAY).toISOString().slice(0, 10)
        const valid = result.bars.filter(b => calendarDay(b.date.slice(0, 10)) && b.date.slice(0, 10) >= from && positive(b.close) != null)
        const unique = [...new Map(valid.map(b => [b.date.slice(0, 10), b])).values()].sort((a, b) => a.date.localeCompare(b.date))
        const completed = closedBars(unique, crypto ? 'BTC' : 'MSTR', '1d', at)
        if (completed.length < 2) throw new IssuerReadError('可用已收盘日线不足两根')
        assertFreshBars(completed, crypto ? 'BTC' : 'MSTR', '1d', at)
        return { bars: completed, source: { provider: result.meta.sourceId ?? provider, dataAt: completed.at(-1)!.date, fetchedAt: at.toISOString(), status: 'ok',
          detail: `${provider === 'alpaca' ? 'Alpaca IEX 日线' : `${provider} 日线`}；仅已收盘价格，不含股息。${failures.length ? `回退原因：${failures.join('；')}` : ''}` } }
      } catch (error) { failures.push(`${provider}: ${safeFailure(error)}`) }
    }
    return { bars: [], source: { provider: providers.join(' → '), dataAt: null, fetchedAt: at.toISOString(), status: 'unavailable', detail: failures.join('；') } }
  }
  async function build(days: 30 | 90 | 365): Promise<DashboardModule> {
    const at = now()
    const [bitcoin, mstr, strc, mstrBars, btcBars, strcBars] = await Promise.all([
      readJson(URLS.bitcoin), readJson(URLS.mstr), readJson(URLS.strc), bars('MSTR', days, at), bars('BTC-USD', days, at), bars('STRC', days, at),
    ])
    const result = strategyIssuerModule({ bitcoin, mstr, strc }, at, days)
    const btcByDay = new Map(btcBars.bars.map(b => [b.date.slice(0, 10), b]))
    const common = mstrBars.bars.filter(b => btcByDay.has(b.date.slice(0, 10)))
    for (const [id, label, data, market] of [
      ['mstr-normalized', 'MSTR 价格指数（起点 100）', common, mstrBars],
      ['btc-normalized', 'BTC 价格指数（起点 100）', common.map(b => btcByDay.get(b.date.slice(0, 10))!), btcBars],
    ] as const) {
      const base = data[0]?.close
      result.series.push({ id, label, unit: 'index', group: 'strategy', referenceValue: 100, maxGapMs: 4 * DAY,
        points: base && data.length >= 2 ? data.map(b => ({ at: b.date.slice(0, 10), value: new Decimal(b.close).div(base).mul(100).toDecimalPlaces(8).toNumber() })) : [],
        source: { ...market.source, status: data.length >= 2 ? market.source.status : 'unavailable', dataAt: data.at(-1)?.date ?? null,
          detail: `${market.source.detail} 同一共同日期起点归一化，仅交集日期；BTC 为 UTC 日收盘，MSTR 为纽约交易日收盘，非同步瞬时收益或相关性。`, formula: '本日收盘 ÷ 两者首个共同日期收盘 × 100', formulaVersion: 'common-calendar-daily-price-v1' } })
    }
    result.series.push({ id: 'strc-daily-price', label: 'STRC 已收盘价格（不含股息）', unit: 'usd', group: 'strc', referenceValue: 100, maxGapMs: 4 * DAY,
      points: strcBars.bars.map(b => ({ at: b.date.slice(0, 10), value: b.close })), source: { ...strcBars.source, detail: `${strcBars.source.detail} $100 仅为约定金额参考线，不代表回售或本金保障。` } })
    reports.set(days, { expires: now().getTime() + 300_000, module: result })
    return result
  }
  return { async read(days: 30 | 90 | 365): Promise<DashboardModule> {
    const cached = reports.get(days)
    if (cached && cached.expires > now().getTime()) return structuredClone(cached.module)
    const pending = running.get(days)
    if (pending) return structuredClone(await pending)
    const task = build(days)
    running.set(days, task)
    try { return structuredClone(await task) } finally { running.delete(days) }
  } }
}
