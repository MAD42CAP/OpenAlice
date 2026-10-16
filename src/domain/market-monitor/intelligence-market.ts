import Decimal from 'decimal.js'
import { createHash } from 'node:crypto'
import { assertFreshBars, closedBars } from './bar-policy.js'
import { isCurrentEquityHourlyEvidence, selectAnalysisHourlyBars } from './equity-session.js'
import type { MarketMonitorSnapshot, TrendHorizon } from './types.js'
import type { EvidenceReference, IntelligenceClaim } from './intelligence-types.js'
import type { MarketIntelligence } from './investment-types.js'

const DAY = 86_400_000
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const stamp = (s: string | null | undefined) => s && Number.isFinite(Date.parse(s)) ? Date.parse(s) : NaN
const validBar = (b: MarketMonitorSnapshot['chart']['daily'][number]) => [b.open, b.high, b.low, b.close].every(finite) && b.low > 0 && b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close) && (b.volume === null || finite(b.volume) && b.volume >= 0)
/** A projection of the existing closed-bar analysis, never a new prediction protocol. */
export function buildMarketIntelligence(snapshot: MarketMonitorSnapshot, at: Date): MarketIntelligence {
  if (!Number.isFinite(at.getTime()) || !Number.isFinite(stamp(snapshot.capturedAt)) || stamp(snapshot.capturedAt) > at.getTime()) throw new Error('市场档案时间不可用或晚于分析时间。')
  const captured = new Date(snapshot.capturedAt)
  const verified = snapshot.analysisBasis?.closedBarsOnly === true
  const asset = snapshot.asset, equity = asset !== 'BTC'
  const daily = closedBars(snapshot.chart.daily, asset, '1d', captured).filter(validBar).sort((a, b) => a.date.localeCompare(b.date))
  const hourlySelection = equity ? selectAnalysisHourlyBars(snapshot.chart.intraday, asset, captured) : null
  const hourly = (hourlySelection ? hourlySelection.continuousBars : closedBars(snapshot.chart.intraday, asset, '1h', captured)).filter(validBar).sort((a, b) => a.date.localeCompare(b.date))
  const last = daily.at(-1), previous = daily.at(-2)
  const dailyUnique = new Set(daily.map(b => b.date.slice(0, 10))).size === daily.length
  const hourlyUnique = new Set(hourly.map(b => b.date)).size === hourly.length
  const dailyAt = verified && dailyUnique && last && snapshot.metrics.lastPrice === last.close && snapshot.analysisBasis?.dailyAt?.slice(0, 10) === last.date.slice(0, 10) ? last.date : null
  const hourlyAt = verified && (!equity || snapshot.analysisBasis?.version === 3 && hourlySelection?.pulse.available) && hourlyUnique && hourly.length && snapshot.analysisBasis?.hourlyAt === hourly.at(-1)!.date ? hourly.at(-1)!.date : null
  const missingData: string[] = equity ? ['临时停市与 2026–2028 之外交易所日历：UNAVAILABLE', '宏观与行业独立风险指标：UNAVAILABLE'] : ['ETF 净流量：UNAVAILABLE', '订单簿与清算热图：UNAVAILABLE', '宏观风险指标：UNAVAILABLE']
  if (daily.length !== closedBars(snapshot.chart.daily, asset, '1d', captured).length || !dailyUnique) missingData.push('日线存在无效或重复数据')
  if ((!equity && hourly.length !== closedBars(snapshot.chart.intraday, asset, '1h', captured).length) || !hourlyUnique) missingData.push('小时线存在无效或重复数据')
  if (equity && snapshot.analysisBasis?.version !== 3) missingData.push('旧股票小时线尚未通过常规交易时段与稀疏量能筛选；等待新版扫描')
  if (equity && hourlySelection && !hourlySelection.pulse.available) missingData.push('常规交易时段小时线缺少连续且量能可用的样本；不能把稀疏栏当作方向证据')
  if (!dailyAt) missingData.push('日线已收盘分析依据不可验证')
  if (!hourlyAt) missingData.push('小时已收盘分析依据不可验证')
  if (!snapshot.trend) missingData.push('多周期结构判读缺失')
  const evidence: EvidenceReference[] = []
  const source = (id: string) => snapshot.sourceHealth.find(s => s.id === id)
  const add = (metric: string, value: number | string | null, unit: string | null, dataAsOf: string | null, sourceId = 'daily-bars', kind: EvidenceReference['kind'] = 'observation'): string => {
    const s = source(sourceId), time = stamp(dataAsOf)
    let quality: EvidenceReference['quality'] = value === null || !Number.isFinite(time) || time > captured.getTime() || s?.status === 'unavailable' || !s ? 'unavailable'
      : at.getTime() - time > (sourceId === 'intraday-bars' ? 3 * 3_600_000 : sourceId === 'btc-derivatives' ? 30 * 60_000 : 2 * DAY) ? 'outdated' : 'available'
    if (equity && value !== null && Number.isFinite(time) && time <= captured.getTime() && s && s.status !== 'unavailable') {
      if (sourceId === 'daily-bars' || sourceId === 'intraday-bars') {
        if (sourceId === 'intraday-bars') quality = isCurrentEquityHourlyEvidence(dataAsOf, at) ? 'available' : 'outdated'
        else { try { assertFreshBars(daily, asset, '1d', at); quality = 'available' } catch { quality = 'outdated' } }
      } else quality = at.getTime() - time > DAY ? 'outdated' : 'available'
    }
    const id = `market:${snapshot.id}:${metric}`
    evidence.push({ id, asset, sourceName: kind === 'interpretation' ? `MAD42Lab rules (${s?.provider ?? 'unknown'})` : s?.provider ?? 'unknown', sourceUrl: null,
      metric, value, unit, dataAsOf, publishedAt: null, retrievedAt: snapshot.capturedAt, quality, reportId: null, kind })
    return id
  }
  const price = dailyAt ? last!.close : null
  const volume = dailyAt ? last!.volume : null
  add('daily-close', price, 'USD', dailyAt)
  add('daily-volume', volume, 'source-native', dailyAt)
  add('daily-change-percent', dailyAt && previous ? new Decimal(last!.close).div(previous.close).minus(1).times(100).toNumber() : null, 'percent', dailyAt)
  const volumeWindow = daily.slice(-21, -1)
  const meanVolume = volumeWindow.length === 20 && volumeWindow.every(b => b.volume !== null) ? volumeWindow.reduce((a, b) => a.plus(b.volume!), new Decimal(0)).div(20) : null
  add('volume-ratio', dailyAt && volume !== null && meanVolume?.gt(0) ? new Decimal(volume).div(meanVolume).toNumber() : null, 'ratio', dailyAt)
  add('hourly-close', hourlyAt ? hourly.at(-1)!.close : null, 'USD', hourlyAt, 'intraday-bars')
  const returns = daily.slice(-21).slice(1).map((bar, i) => new Decimal(bar.close).div(daily.slice(-21)[i]!.close).ln())
  const meanReturn = returns.length ? returns.reduce((a, b) => a.plus(b), new Decimal(0)).div(returns.length) : null
  add('daily-volatility-20', dailyAt && returns.length === 20 && meanReturn ? returns.reduce((a, b) => a.plus(b.minus(meanReturn).pow(2)), new Decimal(0)).div(20).sqrt().times(100).toNumber() : null, 'percent', dailyAt)
  const derivative = source('btc-derivatives')
  for (const [metric, field, unit] of equity ? [] : [['funding-8h', 'fundingRate', 'fraction'], ['open-interest', 'openInterest', 'USD'], ['annualized-basis', 'annualizedBasisPercent', 'percent'], ['option-open-interest', 'optionOpenInterest', 'BTC'], ['put-call-ratio', 'putCallOpenInterestRatio', 'ratio']] as const) {
    const value = snapshot.context[field]
    const valid = finite(value) && !derivative?.failedFields?.includes(field) && !derivative?.retained?.fields.includes(field)
    add(metric, valid ? value : null, unit, derivative?.asOf ?? null, 'btc-derivatives')
    if (!valid) missingData.push(`${metric}：UNAVAILABLE`)
  }
  if (equity) {
    const reference = snapshot.sourceHealth.find(s => s.id.endsWith('-reference'))
    const calendar = snapshot.sourceHealth.find(s => s.id.endsWith('-calendar-news'))
    const filings = snapshot.sourceHealth.find(s => s.id.endsWith('-sec-filings'))
    const fieldValid = (field: keyof typeof snapshot.context, s: typeof reference) => s && s.status !== 'unavailable' && !s.failedFields?.includes(field) && !s.retained?.fields.includes(field)
    for (const [metric, field, unit] of [['equity.market-cap', 'marketCap', 'USD'], ['equity.trailing-pe', 'trailingPe', 'ratio'], ['equity.forward-pe', 'forwardPe', 'ratio'], ['equity.short-float', 'shortPercentFloat', 'fraction']] as const) {
      const value = snapshot.context[field]
      add(metric, fieldValid(field, reference) && finite(value) ? value : null, unit, reference?.asOf ?? null, reference?.id ?? 'equity-reference')
    }
    const earnings = snapshot.context.nextEarningsAt
    const earningsSession = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
    const earningsValid = fieldValid('nextEarningsAt', calendar) && calendar?.coverage?.earnings === 'available' && typeof earnings === 'string' && Number.isFinite(stamp(earnings)) && earnings.slice(0, 10) >= earningsSession
    add('equity.next-earnings', earningsValid ? earnings : null, 'session-date', calendar?.asOf ?? null, calendar?.id ?? 'equity-calendar')
    if (!earningsValid) missingData.push('财报日历未验证；不得假设未来没有财报事件')
    if (fieldValid('recentNews', calendar)) for (const [i, item] of (snapshot.context.recentNews ?? []).slice(0, 12).entries()) {
      if (!item.title?.trim() || !Number.isFinite(stamp(item.time))) continue
      const id = add(`equity.news.${i}`, item.title, null, item.time, calendar!.id, 'interpretation')
      const e = evidence.find(row => row.id === id)!
      e.publishedAt = item.time; e.sourceName = item.source || calendar!.provider
      e.excerpt = '仅来源标题及发布时间；未读取或核实文章正文，不构成已确认因果解释。'
    }
    if (fieldValid('recentFilings', filings)) for (const [i, item] of (snapshot.context.recentFilings ?? []).slice(0, 12).entries()) {
      if (!item.form || !Number.isFinite(stamp(item.filingDate)) || stamp(item.filingDate) > captured.getTime()) continue
      let official = false
      try { const url = new URL(item.url); official = url.protocol === 'https:' && ['www.sec.gov', 'sec.gov'].includes(url.hostname) && url.pathname.startsWith('/Archives/') } catch { /* Invalid URLs are not source evidence. */ }
      if (!official) continue
      const id = add(`equity.sec-filing.${i}`, `${item.form} filed ${item.filingDate}${item.description ? `: ${item.description}` : ''}`, null, filings!.asOf, filings!.id)
      const e = evidence.find(row => row.id === id)!
      e.publishedAt = item.filingDate; e.sourceUrl = item.url
      e.excerpt = 'SEC submissions 申报元数据；尚未解析申报正文，不能据此推断收入、融资条款或事件影响。'
    }
    if (!fieldValid('recentFilings', filings)) missingData.push('SEC 申报元数据暂不可用；未解析申报正文')
    if (!fieldValid('recentNews', calendar) || calendar?.coverage?.news !== 'matched') missingData.push('可核实的公司新闻正文与影响分析：UNAVAILABLE')
    if (asset === 'MSTR') missingData.push('MSTR 比特币持仓、负债、稀释及 STRC 独立分解：UNAVAILABLE')
  }
  const windows = { short: 5, medium: 28, long: 180 }
  const horizons = (['short', 'medium', 'long'] as TrendHorizon[]).map(horizon => {
    const assessment = snapshot.trend?.[horizon]
    const bars = daily.slice(-windows[horizon])
    const support = dailyAt && bars.length ? Math.min(...bars.map(b => b.low)) : null
    const resistance = dailyAt && bars.length ? Math.max(...bars.map(b => b.high)) : null
    const evidenceIds = [add(`trend.${horizon}`, assessment?.direction ?? null, null, dailyAt, 'daily-bars', 'interpretation'), add(`support.${horizon}`, support, 'USD', dailyAt), add(`resistance.${horizon}`, resistance, 'USD', dailyAt)]
    return { horizon, observationWindow: horizon === 'short' ? equity ? '1–5 个交易时段（定性结构，非 1 日预测）' : '1–5 自然日' : horizon === 'medium' ? '1–4 周' : '1–6 个月', direction: assessment?.direction ?? 'insufficient', structure: assessment?.regime ?? 'unknown', supportLevels: support === null ? [] : [support], resistanceLevels: resistance === null ? [] : [resistance],
      momentum: { text: `既有规则方向 ${assessment?.direction ?? 'insufficient'}；量价以已收盘指标为准。`, evidenceIds: [evidenceIds[0]!, `market:${snapshot.id}:volume-ratio`], inference: true }, risks: snapshot.dailyBrief?.risks ?? [], confirmation: snapshot.hypothesis.confirm, invalidation: snapshot.hypothesis.invalidate, evidenceIds }
  })
  const claims = (tone: 'positive' | 'negative'): IntelligenceClaim[] => snapshot.evidence.filter(e => e.tone === tone).map(e => {
    const id = add(`rule.${e.id}`, e.observation, null, e.timeframe === '1H' ? hourlyAt : dailyAt, e.timeframe === '1H' ? 'intraday-bars' : 'daily-bars', 'interpretation')
    return { text: `${e.observation} ${e.interpretation}`, evidenceIds: [id], inference: true }
  })
  const bullishEvidence = claims('positive'), bearishEvidence = claims('negative')
  const dailyEvidence = evidence.find(e => e.metric === 'daily-close')!
  return { schemaVersion: 1, id: `market-${snapshot.id}`, snapshotId: snapshot.id, asset, analysisTime: at.toISOString(), retrievedAt: snapshot.capturedAt, marketDataAsOf: dailyAt, hourlyDataAsOf: hourlyAt, price, volume, priceKind: 'completed-daily-close', daily, hourly, horizons,
    wyckoffHypothesis: snapshot.wyckoff ? { phase: snapshot.wyckoff.phaseCandidate, confirmed: false, supportingEvidence: snapshot.wyckoff.supportingEvidence, opposingEvidence: snapshot.wyckoff.opposingEvidence, confirmation: snapshot.wyckoff.confirmation, invalidation: snapshot.wyckoff.invalidation } : null,
    bullishEvidence, bearishEvidence, evidence, dataSources: snapshot.sourceHealth.map(s => ({ name: s.provider, status: s.status, dataAsOf: s.asOf, retrievedAt: snapshot.capturedAt })),
    dataQuality: dailyEvidence.quality !== 'available' ? 'unavailable' : missingData.length || evidence.some(e => e.quality !== 'available') ? 'partial' : 'complete', missingData,
    limitations: equity ? ['这是既有股票规则与已收盘 OHLCV 的结构化投影；1/5/20 个交易时段的前瞻评估与定性结构期限分开记录。', '股票日线沿用纽约交易日期与 16:15 保守收盘门槛；小时线采用 2026–2028 官方计划常规时段、完整小时桶与同期量能筛选，只保留连续可用样本；不覆盖临时停市。', 'SEC 仅含申报元数据，新闻仅含标题；未知财报日历与缺失正文不能被解释为没有事件风险。', '威科夫、Jev 与研究工作区结论是推断，不增加独立市场证据；已收盘价不是实时行情。'] : ['这是既有规则与真实 OHLCV 的结构化投影，不改变原有 1/7/30 日预测及历史评估定义。', '支撑阻力为已收盘观察窗口的真实高低值，不代表保证有效的交易价位。', 'OHLCV 成交量保留来源原生单位；未获元数据验证时不自动换算或标记为 BTC/USD。量比为最新成交量除以前 20 根日线均量。', '威科夫阶段始终是待验证研究假设；已收盘日线价格不是实时现货报价。'] }
}
export const marketIntelligenceHash = (market: MarketIntelligence) => createHash('sha256').update(JSON.stringify({ ...market, analysisTime: '' })).digest('hex')
