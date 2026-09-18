import { Decimal } from 'decimal.js'
import type { BarService, OhlcvBar } from '../market-data/bars/types.js'
import { safeMarketDataError } from '../market-data/bars/safe-error.js'
import type { DashboardMetric, DashboardModule, DashboardSeries, DashboardSource } from './dashboard-types.js'

const DAY = 86_400_000
const CACHE_MS = 15 * 60_000
const FAILURE_CACHE_MS = 60_000
const ANCHOR = '2024-04-20'
const FNG_URL = 'https://api.alternative.me/fng/?limit=366&format=json'
const FNG_ATTRIBUTION = 'https://alternative.me/crypto/fear-and-greed-index/'
const MVRV_ATTRIBUTION = 'https://github.com/coinmetrics/docs-website/blob/master/asset-metrics/market/capmvrvcur.md'
type Point = DashboardSeries['points'][number]
type History = { bars: OhlcvBar[]; source: DashboardSource; warnings: string[] }
type Sentiment = { points: Point[]; source: DashboardSource }
type Cache = { history: History; sentiment: Sentiment; mvrv: Sentiment }

function day(time: number): string { return new Date(time).toISOString().slice(0, 10) }
function dateTime(value: string): number { return Date.parse(`${value}T00:00:00Z`) }
function dateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dateTime(value)) && day(dateTime(value)) === value
}
function numeric(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function weeklyAverage(bars: OhlcvBar[], at: Date): Point[] {
  const byDate = new Map(bars.map(bar => [bar.date, bar]))
  const first = bars[0]
  if (!first) return []
  // UTC calendar weeks end Sunday; the value becomes available on Monday.
  let monday = dateTime(first.date)
  monday += ((8 - new Date(monday).getUTCDay()) % 7) * DAY
  const completed: Array<{ at: string; value: number }> = []
  const window: Decimal[] = []
  for (; monday + 7 * DAY <= at.getTime(); monday += 7 * DAY) {
    const week = Array.from({ length: 7 }, (_, index) => byDate.get(day(monday + index * DAY)))
    if (week.some(bar => !bar)) { window.length = 0; continue }
    window.push(new Decimal(week[6]!.close))
    if (window.length > 200) window.shift()
    if (window.length === 200) {
      completed.push({ at: new Date(monday + 7 * DAY).toISOString(), value: Decimal.sum(...window).div(200).toNumber() })
    }
  }
  return completed
}

function anchoredAverage(bars: OhlcvBar[]): { points: Point[]; issue?: string } {
  const selected = bars.filter(bar => bar.date >= ANCHOR)
  if (selected[0]?.date !== ANCHOR) return { points: [], issue: `缺少 ${ANCHOR} 锚点起始日，不能计算完整锚定均价。` }
  let amount = new Decimal(0)
  let volume = new Decimal(0)
  const points: Point[] = []
  for (let index = 0; index < selected.length; index++) {
    const bar = selected[index]!
    if (dateTime(bar.date) !== dateTime(ANCHOR) + index * DAY) return { points: [], issue: '锚点之后的日线存在缺口，锚定均价不可用。' }
    if (bar.volume === null || !Number.isFinite(bar.volume) || bar.volume < 0) return { points: [], issue: '锚点之后存在缺失或无效成交量，锚定均价不可用。' }
    const typical = new Decimal(bar.high).plus(bar.low).plus(bar.close).div(3)
    amount = amount.plus(typical.times(bar.volume))
    volume = volume.plus(bar.volume)
    if (volume.gt(0)) points.push({ at: bar.date, value: amount.div(volume).toNumber() })
  }
  if (!points.length) return { points: [], issue: '锚点之后没有正成交量，锚定均价不可用。' }
  return { points }
}

function normalizedBars(input: OhlcvBar[], at: Date): OhlcvBar[] {
  const seen = new Set<string>()
  const today = day(at.getTime())
  const bars: OhlcvBar[] = []
  for (const bar of input) {
    if (!dateOnly(bar.date)) throw new Error('日线日期格式无效。')
    if (bar.date >= today) continue // Never use a still-forming UTC day.
    if (seen.has(bar.date)) throw new Error('日线存在重复日期。')
    seen.add(bar.date)
    if (![bar.open, bar.high, bar.low, bar.close].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
      || bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close)) {
      throw new Error('日线存在无效价格或价格关系。')
    }
    bars.push(bar)
  }
  bars.sort((a, b) => a.date.localeCompare(b.date))
  if (!bars.length) throw new Error('没有可用的已收盘日线。')
  return bars
}

/** Prices retain provider identity throughout fallback; volume is never blended. */
async function loadHistory(barService: BarService, now: () => Date): Promise<History> {
  const at = now()
  const start = day(Math.min(at.getTime() - 1807 * DAY, dateTime(ANCHOR)))
  const warnings: string[] = []
  let best: History | undefined
  let bestScore = -1
  for (const provider of ['coinbase', 'yfinance']) {
    try {
      const result = await barService.getBars({ barId: `${provider}|BTC-USD`, assetClass: 'crypto' }, { interval: '1d', start, end: day(at.getTime() - DAY), count: 5000 })
      const bars = normalizedBars(result.bars, at)
      const latest = bars.at(-1)!
      const fresh = at.getTime() - dateTime(latest.date) <= 2 * DAY
      const weeks = weeklyAverage(bars, at)
      const vwap = anchoredAverage(bars)
      const weekCurrent = weeks.length > 0 && at.getTime() - Date.parse(weeks.at(-1)!.at) < 7 * DAY
      const issues = [!fresh ? '最新已收盘日线超过 48 小时。' : '', !weekCurrent ? '缺少最近连续 200 个完整周的日线。' : '', vwap.issue ?? ''].filter(Boolean)
      const source: DashboardSource = {
        provider: result.meta.sourceId ?? result.meta.provider ?? provider,
        url: provider === 'coinbase' ? 'https://www.coinbase.com/advanced-trade/spot/BTC-USD' : 'https://finance.yahoo.com/quote/BTC-USD/history/',
        dataAt: latest.date, publishedAt: null, fetchedAt: now().toISOString(), status: fresh ? 'ok' : 'stale',
        detail: `${bars.length} 根已收盘日线；UTC 日界；成交量沿用所选来源。`,
      }
      const candidate = { bars, source, warnings: [] }
      const score = Number(fresh) * 4 + Number(weekCurrent) * 2 + Number(!vwap.issue)
      if (score > bestScore) { best = candidate; bestScore = score }
      if (!issues.length) {
        return { ...candidate, warnings, source: { ...source, detail: [source.detail, ...warnings].join(' ') } }
      }
      warnings.push(`${provider}: ${issues.join(' ')}`)
    } catch (error) {
      warnings.push(`${provider}: ${safeMarketDataError(error).slice(0, 350)}`)
    }
  }
  if (best) return { ...best, warnings, source: { ...best.source, detail: [best.source.detail, ...warnings].join(' ') } }
  return {
    bars: [], warnings,
    source: { provider: 'coinbase / yfinance', dataAt: null, publishedAt: null, fetchedAt: now().toISOString(), status: 'unavailable', detail: warnings.join(' ') },
  }
}

async function loadSentiment(fetcher: typeof fetch, now: () => Date): Promise<Sentiment> {
  const base: DashboardSource = { provider: 'Alternative.me', url: FNG_ATTRIBUTION, dataAt: null, publishedAt: null, fetchedAt: now().toISOString(), status: 'unavailable', formulaVersion: 'alternative-me-published-index', detail: '来源：Alternative.me Crypto Fear & Greed Index。' }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetcher(FNG_URL, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`恐惧与贪婪指数 HTTP ${response.status}。`)
    let raw: unknown
    try { raw = await response.json() } catch { throw new Error('恐惧与贪婪指数响应不是有效 JSON。') }
    if (!raw || typeof raw !== 'object') throw new Error('恐惧与贪婪指数响应格式无效。')
    const envelope = raw as { data?: unknown; metadata?: { error?: unknown } }
    if (envelope.metadata?.error || !Array.isArray(envelope.data) || envelope.data.length === 0 || envelope.data.length > 400) throw new Error('恐惧与贪婪指数缺少有效数据。')
    const byDate = new Map<string, Point>()
    for (const entry of envelope.data) {
      if (!entry || typeof entry !== 'object') throw new Error('恐惧与贪婪指数记录格式无效。')
      const record = entry as { value?: unknown; timestamp?: unknown }
      const value = numeric(record.value)
      const seconds = numeric(record.timestamp)
      if (value === null || !Number.isInteger(value) || value < 0 || value > 100 || seconds === null || !Number.isSafeInteger(seconds)
        || seconds * 1000 < Date.parse('2018-01-01') || seconds * 1000 > now().getTime()) throw new Error('恐惧与贪婪指数数值或时间无效（包括未来时间）。')
      const timestamp = new Date(seconds * 1000).toISOString()
      const date = timestamp.slice(0, 10)
      if (byDate.has(date)) throw new Error('恐惧与贪婪指数存在重复日期。')
      byDate.set(date, { at: timestamp, value })
    }
    const points = [...byDate.values()].sort((a, b) => a.at.localeCompare(b.at))
    const latest = points.at(-1)!
    const stale = now().getTime() - Date.parse(latest.at) > 2 * DAY
    return { points, source: { ...base, dataAt: latest.at, fetchedAt: now().toISOString(), status: stale ? 'stale' : 'ok', detail: `${base.detail} ${stale ? '最新指数超过 48 小时，仅保留历史供查看。' : '每日更新；指数不是价格预测概率。'} 共 ${points.length} 个有效日值；缺日不插值。` } }
  } catch (error) {
    // External network exceptions and response bodies can contain arbitrary text.
    const detail = error instanceof Error && error.message.startsWith('恐惧与贪婪指数') ? error.message : controller.signal.aborted ? '恐惧与贪婪指数请求超时。' : '恐惧与贪婪指数网络请求失败。'
    return { points: [], source: { ...base, fetchedAt: now().toISOString(), detail } }
  } finally { clearTimeout(timeout) }
}

async function loadMvrv(fetcher: typeof fetch, now: () => Date): Promise<Sentiment> {
  const at = now()
  const start = day(at.getTime() - 366 * DAY)
  const end = day(at.getTime() - DAY)
  const query = new URLSearchParams({ assets: 'btc', metrics: 'CapMVRVCur', frequency: '1d', start_time: start, end_time: end, page_size: '400' })
  const source: DashboardSource = {
    provider: 'Coin Metrics Community', url: MVRV_ATTRIBUTION, dataAt: null, publishedAt: null, fetchedAt: at.toISOString(), status: 'unavailable',
    formula: 'CapMVRVCur = CapMrktCurUSD / CapRealUSD（市值 / 已实现市值），使用 Coin Metrics 公开日值。', formulaVersion: 'coinmetrics-CapMVRVCur-1d-v1',
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetcher(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?${query}`, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error(`MVRV HTTP ${response.status}。`)
    let raw: unknown
    try { raw = await response.json() } catch { throw new Error('MVRV 响应不是有效 JSON。') }
    if (!raw || typeof raw !== 'object') throw new Error('MVRV 响应格式无效。')
    const body = raw as { data?: unknown; next_page_url?: unknown; next_page_token?: unknown; error?: unknown }
    if (body.error || !Array.isArray(body.data) || !body.data.length || body.data.length > 400) throw new Error('MVRV 缺少有效日值。')
    // The explicit 366-day window fits one page; never follow arbitrary URLs.
    if (body.next_page_url || body.next_page_token) throw new Error('MVRV 返回未完成分页，历史数据不可用。')
    const byDate = new Map<string, Point>()
    for (const item of body.data) {
      if (!item || typeof item !== 'object') throw new Error('MVRV 记录格式无效。')
      const record = item as { asset?: unknown; time?: unknown; CapMVRVCur?: unknown }
      const value = numeric(record.CapMVRVCur)
      const time = typeof record.time === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.\d{1,9})?Z$/.test(record.time) ? record.time.slice(0, 10) : ''
      if (record.asset !== 'btc' || !dateOnly(time) || time < start || time > end || value === null || value <= 0) throw new Error('MVRV 资产、数值或时间无效（包括未来时间）。')
      if (byDate.has(time)) throw new Error('MVRV 存在重复日期。')
      byDate.set(time, { at: time, value })
    }
    const points = [...byDate.values()].sort((a, b) => a.at.localeCompare(b.at))
    const latest = points.at(-1)!
    const stale = now().getTime() - dateTime(latest.at) > 3 * DAY
    return { points, source: { ...source, dataAt: latest.at, fetchedAt: now().toISOString(), status: stale ? 'stale' : 'ok', detail: `来源：Coin Metrics Community（CC BY-NC 4.0），${points.length} 个有效日值；数据日期沿用供应商，公布时间未知。${stale ? '最新日值超过 72 小时，仅保留历史。' : '比值不是买卖信号或概率。'} 缺日不插值。` } }
  } catch (error) {
    const detail = error instanceof Error && error.message.startsWith('MVRV ') ? error.message : controller.signal.aborted ? 'MVRV 请求超时。' : 'MVRV 网络请求失败。'
    return { points: [], source: { ...source, fetchedAt: now().toISOString(), detail } }
  } finally { clearTimeout(timeout) }
}

function render(cache: Cache, days: 30 | 90 | 365, at: Date): DashboardModule {
  const { history, sentiment, mvrv } = cache
  const cutoff = day(at.getTime() - days * DAY)
  const visible = (points: Point[]) => points.filter(point => point.at.slice(0, 10) >= cutoff)
  const last = history.bars.at(-1)
  const barSource = { ...history.source }
  if (last && at.getTime() - dateTime(last.date) > 2 * DAY) barSource.status = 'stale'
  const weekly = weeklyAverage(history.bars, at)
  const weeklyLatest = weekly.at(-1)
  const weeklyCurrent = !!weeklyLatest && at.getTime() - Date.parse(weeklyLatest.at) < 7 * DAY
  const weekSource: DashboardSource = {
    ...barSource, dataAt: weeklyLatest?.at ?? null, status: weeklyCurrent && barSource.status === 'ok' ? 'ok' : weekly.length ? 'stale' : 'unavailable',
    formula: '最近 200 个连续完整 UTC 周的周日收盘价算术平均；周一 00:00 UTC 起可用。', formulaVersion: 'btc-200w-close-v1',
    detail: [barSource.detail, !weeklyCurrent ? '缺少最近连续 200 个完整周，不能显示当前 200 周均线。' : '已排除当前未完成周。'].join(' '),
  }
  const anchored = anchoredAverage(history.bars)
  const vwapSource: DashboardSource = {
    ...barSource, status: anchored.issue ? 'unavailable' : barSource.status,
    formula: '自 2024-04-20 UTC 日线起，Σ[((最高+最低+收盘)/3)×来源成交量] / Σ来源成交量。', formulaVersion: 'btc-20240420-daily-typical-vwap-v1',
    detail: [barSource.detail, anchored.issue ?? '使用单一来源的日线成交量，非逐笔成交 VWAP，非全市场持有人成本。'].join(' '),
  }
  const sentimentSource = { ...sentiment.source }
  if (sentimentSource.dataAt && at.getTime() - Date.parse(sentimentSource.dataAt) > 2 * DAY) sentimentSource.status = 'stale'
  const mvrvSource = { ...mvrv.source }
  if (mvrvSource.dataAt && at.getTime() - dateTime(mvrvSource.dataAt) > 3 * DAY) mvrvSource.status = 'stale'
  const metric = (id: string, label: string, value: number | undefined, unit: DashboardMetric['unit'], description: string, source: DashboardSource): DashboardMetric => ({ id, label, value: source.status === 'ok' && value !== undefined ? value : null, unit, description, source })
  const mean = weekSource.status === 'ok' ? weeklyLatest?.value : undefined
  return {
    id: 'btc-cycle', label: 'BTC 周期与情绪',
    metrics: [
      metric('btc-closed-price', 'BTC 已收盘价格', last?.close, 'usd', '最后一个完整 UTC 日的收盘价，用于与长期参照比较。', barSource),
      metric('btc-200w-ma', '200 周均线', mean, 'usd', '长期价格参照；只使用连续 200 个完整周，不使用正在形成的本周。', weekSource),
      metric('btc-200w-ratio', '价格 / 200 周均线', mean && last ? new Decimal(last.close).div(mean).toNumber() : undefined, 'ratio', '1 表示价格等于长期均线；高低位置本身不构成买卖信号。', { ...weekSource, dataAt: last?.date ?? null, formula: '最后完整日收盘价 / 最近可用的完整 200 周均线。', detail: `${weekSource.detail} 周均线可用时间：${weeklyLatest?.at ?? '未知'}。` }),
      metric('btc-anchored-vwap', '2024 减半日锚定均价', anchored.points.at(-1)?.value, 'usd', '从 2024-04-20 UTC 日线起算的典型价格成交量加权均价；来源切换会改变成交量口径。', vwapSource),
      metric('btc-fear-greed', '恐惧与贪婪指数', sentiment.points.at(-1)?.value, 'index', '来源：Alternative.me。0 为极度恐惧，100 为极度贪婪；包含价格相关因素，不作为独立概率。', sentimentSource),
      metric('btc-mvrv', 'MVRV 市值 / 已实现市值', mvrv.points.at(-1)?.value, 'ratio', '来源：Coin Metrics Community。以链上币最后移动时的价格估计已实现市值，并非所有持有人的实际成本。', mvrvSource),
    ],
    series: [
      { id: 'btc-cycle-close', timeAxis: 'utc-date', label: 'BTC 已收盘日线', unit: 'usd', group: 'price', points: visible(history.bars.map(bar => ({ at: bar.date, value: bar.close }))), source: barSource, maxGapMs: 1.5 * DAY },
      { id: 'btc-200w-ma', timeAxis: 'utc-date', label: '200 周均线', unit: 'usd', group: 'price', points: visible(weekly), source: weekSource, maxGapMs: 7 * DAY },
      { id: 'btc-anchored-vwap', timeAxis: 'utc-date', label: '2024 减半日锚定均价', unit: 'usd', group: 'price', points: visible(anchored.points), source: vwapSource, maxGapMs: 1.5 * DAY },
      { id: 'btc-fear-greed', timeAxis: 'utc-date', label: '恐惧与贪婪指数 · Alternative.me', unit: 'index', group: 'cycle', points: visible(sentiment.points), source: sentimentSource, referenceValue: 50, maxGapMs: 1.5 * DAY },
      { id: 'btc-mvrv', timeAxis: 'utc-date', label: 'MVRV · Coin Metrics Community', unit: 'ratio', group: 'cycle', points: visible(mvrv.points), source: mvrvSource, referenceValue: 1, maxGapMs: 1.5 * DAY },
    ], events: [],
    notes: [
      '周期与情绪仅作背景，不改变现有趋势或威科夫评分；长期价格位置与短期方向可以不同。',
      '历史序列是本次向来源取得的历史数据，未验证各历史日期当时的发布时间，不用于替代原始判断存档。',
      '恐惧与贪婪指数来源：Alternative.me（https://alternative.me/crypto/fear-and-greed-index/）。',
      'MVRV 来源：Coin Metrics Community（https://gitbook-docs.coinmetrics.io/packages/coin-metrics-community-data），按 CC BY-NC 4.0 提供非商业社区数据（https://creativecommons.org/licenses/by-nc/4.0/）。',
      ...history.warnings,
    ],
  }
}

/** Bounded shared history cache; requests for different windows share one load. */
export function createBtcDashboard(options: { barService: BarService; fetcher?: typeof fetch; now?: () => Date }) {
  const now = options.now ?? (() => new Date())
  const fetcher = options.fetcher ?? fetch
  function cached<T extends { source: DashboardSource }>(loader: () => Promise<T>) {
    let value: T | undefined
    let expiresAt = 0
    let pending: Promise<T> | undefined
    return async () => {
      if (value && now().getTime() < expiresAt) return value
      pending ??= loader().then(result => {
        value = result
        expiresAt = now().getTime() + (result.source.status === 'ok' ? CACHE_MS : FAILURE_CACHE_MS)
        return result
      }).finally(() => { pending = undefined })
      return pending
    }
  }
  // An unavailable sentiment feed must not repeatedly reload years of candles.
  const history = cached(() => loadHistory(options.barService, now))
  const sentiment = cached(() => loadSentiment(fetcher, now))
  const mvrv = cached(() => loadMvrv(fetcher, now))
  return {
    async read(days: 30 | 90 | 365): Promise<DashboardModule> {
      const [historyValue, sentimentValue, mvrvValue] = await Promise.all([history(), sentiment(), mvrv()])
      return render({ history: historyValue, sentiment: sentimentValue, mvrv: mvrvValue }, days, now())
    },
  }
}
