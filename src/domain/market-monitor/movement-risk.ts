import Decimal from 'decimal.js'
import { assertFreshBars, closedBars } from './bar-policy.js'
import { buildMarketIntelligence } from './intelligence-market.js'
import { movementPriceFromQuote, movementPriceFromSnapshot } from './movement-alerts.js'
import type { MovementPrice } from './movement-alert-types.js'
import { MARKET_MONITOR_ASSET_CONFIG, type MarketMonitorSnapshot, type TrendHorizon } from './types.js'
import type { MarketQuote } from '../market-data/quotes.js'

export type { MovementRisk, MovementRiskReason, MovementRiskBoundary, MovementRiskScenario, MovementRiskHorizon } from './movement-risk-types.js'
import type { MovementRisk, MovementRiskReason, MovementRiskBoundary, MovementRiskScenario, MovementRiskHorizon } from './movement-risk-types.js'

const windows = { short: 5, medium: 28, long: 180 } as const
const horizons = ['short', 'medium', 'long'] as const
const finitePrice = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const stamp = (value: string | null | undefined): number => typeof value === 'string' ? Date.parse(value) : NaN

/** Existing closed-bar structure plus an attributed price reference. No forecast,
 * model output, retained context, network request or saved record is consumed. */
export function buildMovementRisk(snapshot: MarketMonitorSnapshot | null, anchor: MovementPrice | null, at: Date): MovementRisk {
  const empty = (reason: MovementRiskReason, status: 'unavailable' | 'outdated' = 'unavailable', reference: MovementPrice | null = null): MovementRisk => ({
    protocol: 'market-movement-risk-v1', status, reason, reference: reference ? { ...reference } : null, analysis: null, horizons: [],
  })
  if (!snapshot) return empty('snapshot-unavailable')
  if (!anchor) return empty('reference-unavailable')
  if (anchor.asset !== snapshot.asset) return empty('asset-mismatch')
  if (!Number.isFinite(at.getTime()) || !finitePrice(anchor.price) || !anchor.provider?.trim()
    || !['last-trade', 'completed-daily-close'].includes(anchor.priceKind) || !['fresh', 'delayed'].includes(anchor.status)
    || !Number.isFinite(stamp(anchor.asOf)) || !Number.isFinite(stamp(anchor.observedAt))
    || stamp(anchor.asOf) > stamp(anchor.observedAt) || stamp(anchor.observedAt) > at.getTime()) return empty('reference-invalid')
  if (!Number.isFinite(stamp(snapshot.capturedAt)) || stamp(snapshot.capturedAt) > at.getTime()
    || !Array.isArray(snapshot.sourceHealth) || !Array.isArray(snapshot.chart?.daily) || !Array.isArray(snapshot.chart?.intraday)
    || !MARKET_MONITOR_ASSET_CONFIG[snapshot.asset] || snapshot.chart.dailyMeta?.symbol !== MARKET_MONITOR_ASSET_CONFIG[snapshot.asset].symbol) return empty('snapshot-invalid')
  const source = snapshot.sourceHealth.find(row => row.id === 'daily-bars')
  if (!source || !['ok', 'degraded'].includes(source.status) || !source.provider?.trim() || source.retained
    || !Number.isFinite(stamp(source.asOf)) || stamp(source.asOf) > stamp(snapshot.capturedAt)) return empty('daily-source-unavailable')
  if (snapshot.chart.daily.some(bar => {
    if (!bar || typeof bar.date !== 'string') return true
    const day = bar.date.slice(0, 10), time = Date.parse(day)
    return !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== day
  })) return empty('daily-bars-invalid')
  const bars = closedBars(snapshot.chart.daily, snapshot.asset, '1d', new Date(snapshot.capturedAt))
  const validBars = bars.every(bar => [bar.open, bar.high, bar.low, bar.close].every(finitePrice)
    && bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close)
    && (bar.volume === null || Number.isFinite(bar.volume) && bar.volume >= 0))
  if (!validBars || new Set(bars.map(bar => bar.date.slice(0, 10))).size !== bars.length) return empty('daily-bars-invalid')
  if (!bars.length) return empty('daily-basis-unverified')
  try { assertFreshBars(bars, snapshot.asset, '1d', at) } catch { return empty('daily-bars-outdated', 'outdated', anchor) }
  let market: ReturnType<typeof buildMarketIntelligence>
  try { market = buildMarketIntelligence(snapshot, at) } catch { return empty('snapshot-invalid') }
  const closeEvidence = market.evidence.find(row => row.metric === 'daily-close')
  if (!finitePrice(market.price) || !market.marketDataAsOf || closeEvidence?.quality !== 'available') return empty('daily-basis-unverified')
  // Reuse the actual quote provider's freshness/identity rules, including Yahoo's
  // disclosed equity delay; successful acquisition never refreshes an old trade.
  if (anchor.priceKind === 'last-trade') {
    const feeds = { coinbase: 'Coinbase Exchange', alpaca: 'IEX', yfinance: 'Yahoo Finance' }
    if (!(anchor.provider in feeds) || anchor.feed !== feeds[anchor.provider as keyof typeof feeds]
      || anchor.provider === 'coinbase' && snapshot.asset !== 'BTC' || anchor.provider === 'alpaca' && snapshot.asset === 'BTC') return empty('reference-invalid')
    const reference = movementPriceFromQuote({ asset: anchor.asset, price: anchor.price, asOf: anchor.asOf, fetchedAt: anchor.observedAt,
      provider: anchor.provider as MarketQuote['provider'], feed: anchor.feed as MarketQuote['feed'], status: anchor.status, currency: 'USD', attempts: [] }, snapshot.asset, at)
    if (!reference) return empty('reference-outdated', 'outdated', anchor)
  } else {
    const reference = movementPriceFromSnapshot(snapshot, snapshot.asset, at)
    if (!reference || reference.price !== anchor.price || reference.asOf !== anchor.asOf
      || reference.observedAt !== anchor.observedAt || reference.provider !== anchor.provider || anchor.feed !== null) return empty('reference-close-mismatch')
  }
  const observed = market.horizons.filter(row => market.daily.length >= windows[row.horizon])
  const boundary = (horizon: TrendHorizon, side: 'downside' | 'upside'): MovementRiskBoundary | null => {
    const row = observed.find(row => row.horizon === horizon)
    const level = (side === 'downside' ? row?.supportLevels : row?.resistanceLevels)?.[0]
    const metric = `${side === 'downside' ? 'support' : 'resistance'}.${horizon}`
    const evidence = market.evidence.find(e => e.metric === metric)
    if (!finitePrice(level) || evidence?.quality !== 'available' || evidence.value !== level || !evidence.dataAsOf) return null
    return { price: level, distancePercent: new Decimal(level).div(anchor.price).minus(1).times(100).toNumber(),
      priceCrossed: side === 'downside' ? anchor.price < level : anchor.price > level,
      dailyCloseConfirmed: null, confirmationStatus: 'not-evaluated-current-structure',
      sourceHorizon: horizon, dataAsOf: evidence.dataAsOf, evidenceIds: [evidence.id] }
  }
  const result: MovementRiskHorizon[] = horizons.map(horizon => {
    const enough = market.daily.length >= windows[horizon]
    const scenario = (side: 'downside' | 'upside'): MovementRiskScenario | null => {
      const first = boundary(horizon, side)
      if (!first) return null
      const candidates = horizons.map(h => boundary(h, side)).filter((b): b is MovementRiskBoundary => Boolean(b)
        && (side === 'downside' ? b!.price < first.price : b!.price > first.price))
        .sort((a, b) => side === 'downside' ? b.price - a.price : a.price - b.price)
      return { boundary: first, nextBoundary: candidates[0] ?? null }
    }
    return { horizon, observationBars: windows[horizon], observedBars: Math.min(market.daily.length, windows[horizon]),
      observationWindow: market.horizons.find(row => row.horizon === horizon)!.observationWindow,
      status: enough ? 'available' : 'unavailable', reason: enough ? null : 'insufficient-daily-bars',
      downside: enough ? scenario('downside') : null, upside: enough ? scenario('upside') : null }
  })
  if (!result[0]!.downside || !result[0]!.upside) return empty('insufficient-daily-bars')
  return { protocol: 'market-movement-risk-v1', status: 'available', reason: null, reference: { ...anchor },
    analysis: { snapshotId: snapshot.id, strategyId: snapshot.strategyId, capturedAt: snapshot.capturedAt, dataAsOf: market.marketDataAsOf,
      provider: source.provider, sourceStatus: source.status as 'ok' | 'degraded', dailyClose: market.price, evidenceIds: [closeEvidence.id] }, horizons: result }
}
