import Decimal from 'decimal.js'
import { createHash } from 'node:crypto'
import { closedBars } from './bar-policy.js'
import type { MarketMonitorSnapshot, TrendHorizon } from './types.js'
import type { EvidenceReference, IntelligenceClaim } from './intelligence-types.js'
import type { MarketIntelligence } from './investment-types.js'

const DAY = 86_400_000
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const stamp = (s: string | null | undefined) => s && Number.isFinite(Date.parse(s)) ? Date.parse(s) : NaN
const validBar = (b: MarketMonitorSnapshot['chart']['daily'][number]) => [b.open, b.high, b.low, b.close].every(finite) && b.low > 0 && b.high >= Math.max(b.open, b.close, b.low) && b.low <= Math.min(b.open, b.close) && (b.volume === null || finite(b.volume) && b.volume >= 0)
/** A projection of the existing closed-bar analysis, never a new prediction protocol. */
export function buildMarketIntelligence(snapshot: MarketMonitorSnapshot, at: Date): MarketIntelligence {
  if (snapshot.asset !== 'BTC') throw new Error('三层研究本轮只支持 BTC。')
  if (!Number.isFinite(at.getTime()) || !Number.isFinite(stamp(snapshot.capturedAt)) || stamp(snapshot.capturedAt) > at.getTime()) throw new Error('市场档案时间不可用或晚于分析时间。')
  const captured = new Date(snapshot.capturedAt)
  const verified = snapshot.analysisBasis?.closedBarsOnly === true
  const daily = closedBars(snapshot.chart.daily, 'BTC', '1d', captured).filter(validBar).sort((a, b) => a.date.localeCompare(b.date))
  const hourly = closedBars(snapshot.chart.intraday, 'BTC', '1h', captured).filter(validBar).sort((a, b) => a.date.localeCompare(b.date))
  const last = daily.at(-1), previous = daily.at(-2)
  const dailyUnique = new Set(daily.map(b => b.date.slice(0, 10))).size === daily.length
  const hourlyUnique = new Set(hourly.map(b => b.date)).size === hourly.length
  const dailyAt = verified && dailyUnique && last && snapshot.metrics.lastPrice === last.close && snapshot.analysisBasis?.dailyAt?.slice(0, 10) === last.date.slice(0, 10) ? last.date : null
  const hourlyAt = verified && hourlyUnique && hourly.length && snapshot.analysisBasis?.hourlyAt === hourly.at(-1)!.date ? hourly.at(-1)!.date : null
  const missingData: string[] = ['ETF 净流量：UNAVAILABLE', '订单簿与清算热图：UNAVAILABLE', '宏观风险指标：UNAVAILABLE']
  if (daily.length !== closedBars(snapshot.chart.daily, 'BTC', '1d', captured).length || !dailyUnique) missingData.push('日线存在无效或重复数据')
  if (hourly.length !== closedBars(snapshot.chart.intraday, 'BTC', '1h', captured).length || !hourlyUnique) missingData.push('小时线存在无效或重复数据')
  if (!dailyAt) missingData.push('日线已收盘分析依据不可验证')
  if (!hourlyAt) missingData.push('小时已收盘分析依据不可验证')
  if (!snapshot.trend) missingData.push('多周期结构判读缺失')
  const evidence: EvidenceReference[] = []
  const source = (id: string) => snapshot.sourceHealth.find(s => s.id === id)
  const add = (metric: string, value: number | string | null, unit: string | null, dataAsOf: string | null, sourceId = 'daily-bars', kind: EvidenceReference['kind'] = 'observation'): string => {
    const s = source(sourceId), time = stamp(dataAsOf)
    const quality: EvidenceReference['quality'] = value === null || !Number.isFinite(time) || time > captured.getTime() || s?.status === 'unavailable' || !s ? 'unavailable'
      : at.getTime() - time > (sourceId === 'intraday-bars' ? 3 * 3_600_000 : sourceId === 'btc-derivatives' ? 30 * 60_000 : 2 * DAY) ? 'outdated' : 'available'
    const id = `market:${snapshot.id}:${metric}`
    evidence.push({ id, asset: 'BTC', sourceName: kind === 'interpretation' ? `MAD42Lab rules (${s?.provider ?? 'unknown'})` : s?.provider ?? 'unknown', sourceUrl: null,
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
  for (const [metric, field, unit] of [['funding-8h', 'fundingRate', 'fraction'], ['open-interest', 'openInterest', 'USD'], ['annualized-basis', 'annualizedBasisPercent', 'percent'], ['option-open-interest', 'optionOpenInterest', 'BTC'], ['put-call-ratio', 'putCallOpenInterestRatio', 'ratio']] as const) {
    const value = snapshot.context[field]
    const valid = finite(value) && !derivative?.failedFields?.includes(field) && !derivative?.retained?.fields.includes(field)
    add(metric, valid ? value : null, unit, derivative?.asOf ?? null, 'btc-derivatives')
    if (!valid) missingData.push(`${metric}：UNAVAILABLE`)
  }
  const windows = { short: 5, medium: 28, long: 180 }
  const horizons = (['short', 'medium', 'long'] as TrendHorizon[]).map(horizon => {
    const assessment = snapshot.trend?.[horizon]
    const bars = daily.slice(-windows[horizon])
    const support = dailyAt && bars.length ? Math.min(...bars.map(b => b.low)) : null
    const resistance = dailyAt && bars.length ? Math.max(...bars.map(b => b.high)) : null
    const evidenceIds = [add(`trend.${horizon}`, assessment?.direction ?? null, null, dailyAt, 'daily-bars', 'interpretation'), add(`support.${horizon}`, support, 'USD', dailyAt), add(`resistance.${horizon}`, resistance, 'USD', dailyAt)]
    return { horizon, observationWindow: horizon === 'short' ? '1–5 自然日' : horizon === 'medium' ? '1–4 周' : '1–6 个月', direction: assessment?.direction ?? 'insufficient', structure: assessment?.regime ?? 'unknown', supportLevels: support === null ? [] : [support], resistanceLevels: resistance === null ? [] : [resistance],
      momentum: { text: `既有规则方向 ${assessment?.direction ?? 'insufficient'}；量价以已收盘指标为准。`, evidenceIds: [evidenceIds[0]!, `market:${snapshot.id}:volume-ratio`], inference: true }, risks: snapshot.dailyBrief?.risks ?? [], confirmation: snapshot.hypothesis.confirm, invalidation: snapshot.hypothesis.invalidate, evidenceIds }
  })
  const claims = (tone: 'positive' | 'negative'): IntelligenceClaim[] => snapshot.evidence.filter(e => e.tone === tone).map(e => {
    const id = add(`rule.${e.id}`, e.observation, null, e.timeframe === '1H' ? hourlyAt : dailyAt, e.timeframe === '1H' ? 'intraday-bars' : 'daily-bars', 'interpretation')
    return { text: `${e.observation} ${e.interpretation}`, evidenceIds: [id], inference: true }
  })
  const bullishEvidence = claims('positive'), bearishEvidence = claims('negative')
  const dailyEvidence = evidence.find(e => e.metric === 'daily-close')!
  return { schemaVersion: 1, id: `market-${snapshot.id}`, snapshotId: snapshot.id, asset: 'BTC', analysisTime: at.toISOString(), retrievedAt: snapshot.capturedAt, marketDataAsOf: dailyAt, hourlyDataAsOf: hourlyAt, price, volume, priceKind: 'completed-daily-close', daily, hourly, horizons,
    wyckoffHypothesis: snapshot.wyckoff ? { phase: snapshot.wyckoff.phaseCandidate, confirmed: false, supportingEvidence: snapshot.wyckoff.supportingEvidence, opposingEvidence: snapshot.wyckoff.opposingEvidence, confirmation: snapshot.wyckoff.confirmation, invalidation: snapshot.wyckoff.invalidation } : null,
    bullishEvidence, bearishEvidence, evidence, dataSources: snapshot.sourceHealth.map(s => ({ name: s.provider, status: s.status, dataAsOf: s.asOf, retrievedAt: snapshot.capturedAt })),
    dataQuality: dailyEvidence.quality !== 'available' ? 'unavailable' : missingData.length || evidence.some(e => e.quality !== 'available') ? 'partial' : 'complete', missingData,
    limitations: ['这是既有规则与真实 OHLCV 的结构化投影，不改变原有 1/7/30 日预测及历史评估定义。', '支撑阻力为已收盘观察窗口的真实高低值，不代表保证有效的交易价位。', 'OHLCV 成交量保留来源原生单位；未获元数据验证时不自动换算或标记为 BTC/USD。量比为最新成交量除以前 20 根日线均量。', '威科夫阶段始终是待验证研究假设；已收盘日线价格不是实时现货报价。'] }
}
export const marketIntelligenceHash = (market: MarketIntelligence) => createHash('sha256').update(JSON.stringify({ ...market, analysisTime: '' })).digest('hex')
