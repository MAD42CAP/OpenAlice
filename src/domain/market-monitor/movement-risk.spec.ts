import { describe, expect, it } from 'vitest'
import { judgmentSnapshot } from './judgment.fixture.js'
import { movementPriceFromSnapshot } from './movement-alerts.js'
import { buildMovementRisk } from './movement-risk.js'
import type { MovementPrice } from './movement-alert-types.js'
import type { MarketMonitorAsset, MarketMonitorSnapshot } from './types.js'

const at = new Date('2026-09-20T12:00:00Z')
function snapshot(asset: MarketMonitorAsset = 'BTC'): MarketMonitorSnapshot {
  const s = judgmentSnapshot()
  s.asset = asset; s.id = `risk-${asset}`
  const days: string[] = []
  for (let day = Date.parse(asset === 'BTC' ? '2026-09-19' : '2026-09-18'); days.length < 200; day -= 86_400_000) {
    if (asset === 'BTC' || ![0, 6].includes(new Date(day).getUTCDay())) days.unshift(new Date(day).toISOString().slice(0, 10))
  }
  s.chart.daily = days.map((date, i) => ({ date, open: 100, close: 100, volume: 100,
    low: i >= 195 ? 95 : i >= 172 ? 90 : 80, high: i >= 195 ? 105 : i >= 172 ? 110 : 120 }))
  s.metrics.lastPrice = 100
  s.analysisBasis = { version: asset === 'BTC' ? 2 : 3, closedBarsOnly: true, dailyAt: days.at(-1)!, hourlyAt: s.analysisBasis!.hourlyAt }
  s.chart.dailyMeta = { ...s.chart.dailyMeta, symbol: asset === 'BTC' ? 'BTC-USD' : asset, from: days[0]!, to: days.at(-1)!, bars: days.length }
  return s
}
function quote(asset: MarketMonitorAsset = 'BTC', price = 100, now = at): MovementPrice {
  return { asset, price, asOf: now.toISOString(), observedAt: now.toISOString(), provider: asset === 'BTC' ? 'coinbase' : 'alpaca',
    feed: asset === 'BTC' ? 'Coinbase Exchange' : 'IEX', priceKind: 'last-trade', status: 'fresh' }
}

describe('conditional movement structure projection', () => {
  it('uses the existing closed 5/28/180-bar extrema, signed Decimal distances and exact evidence identities', () => {
    const s = snapshot(), anchor = quote(), before = JSON.stringify({ s, anchor })
    const risk = buildMovementRisk(s, anchor, at)
    expect(risk).toMatchObject({ protocol: 'market-movement-risk-v1', status: 'available', reason: null,
      analysis: { snapshotId: s.id, capturedAt: s.capturedAt, dataAsOf: '2026-09-19', dailyClose: 100, provider: 'test-provider', evidenceIds: [`market:${s.id}:daily-close`] } })
    const [short, medium, long] = risk.horizons
    expect(short).toMatchObject({ observationBars: 5, observedBars: 5,
      downside: { boundary: { price: 95, distancePercent: -5, sourceHorizon: 'short', evidenceIds: [`market:${s.id}:support.short`] }, nextBoundary: { price: 90, distancePercent: -10, sourceHorizon: 'medium', evidenceIds: [`market:${s.id}:support.medium`] } },
      upside: { boundary: { price: 105, distancePercent: 5 }, nextBoundary: { price: 110, distancePercent: 10 } } })
    expect(medium).toMatchObject({ observationBars: 28, downside: { boundary: { price: 90 }, nextBoundary: { price: 80, sourceHorizon: 'long' } } })
    expect(long).toMatchObject({ observationBars: 180, downside: { boundary: { price: 80 }, nextBoundary: null }, upside: { boundary: { price: 120 }, nextBoundary: null } })
    expect(JSON.stringify({ s, anchor })).toBe(before)
    expect(JSON.stringify(risk)).not.toMatch(/probability|targetReturn/)
  })

  it('does not turn a crossed support into a remaining drop or confirm it with the current quote', () => {
    const risk = buildMovementRisk(snapshot(), quote('BTC', 94), at)
    const down = risk.horizons[0]!.downside!
    expect(down.boundary.priceCrossed).toBe(true)
    expect(down.boundary.dailyCloseConfirmed).toBeNull()
    expect(down.boundary.confirmationStatus).toBe('not-evaluated-current-structure')
    expect(down.boundary.distancePercent).toBeCloseTo(1.0638297872340425, 12)
    expect(down.nextBoundary!.distancePercent).toBeCloseTo(-4.25531914893617, 12)
    expect(risk.analysis!.dailyClose).toBe(100)
  })

  it('keeps a crossed resistance negative and separates quote crossing from the frozen daily close', () => {
    const risk = buildMovementRisk(snapshot(), quote('BTC', 106), at)
    expect(risk.horizons[0]!.upside!.boundary).toMatchObject({ priceCrossed: true, dailyCloseConfirmed: null })
    expect(risk.horizons[0]!.upside!.boundary.distancePercent).toBeCloseTo(-0.9433962264150944, 12)
    expect(buildMovementRisk(snapshot(), quote('BTC', 95), at).horizons[0]!.downside!.boundary.priceCrossed).toBe(false)
  })

  it('uses no forming daily bar or model prose as a structural boundary', () => {
    const s = snapshot()
    s.chart.daily.push({ date: '2026-09-20', open: 100, close: 100, low: 1, high: 1_000, volume: 100 })
    s.aiNarration = { summary: 'fall toward $1', generatedAt: at.toISOString() } as never
    const risk = buildMovementRisk(s, quote(), at)
    expect(risk.status).toBe('available')
    expect(risk.horizons[0]!.downside!.boundary.price).toBe(95)
    expect(risk.horizons[2]!.upside!.boundary.price).toBe(120)
    expect(risk.horizons.every(h => h.downside!.boundary.dailyCloseConfirmed === null && h.upside!.boundary.dailyCloseConfirmed === null)).toBe(true)
  })

  it('does not invent a next level when all observed support or resistance prices coincide', () => {
    const s = snapshot()
    s.chart.daily.forEach(b => { b.low = 95; b.high = 105 })
    const risk = buildMovementRisk(s, quote(), at)
    expect(risk.horizons.every(h => h.downside?.nextBoundary === null && h.upside?.nextBoundary === null)).toBe(true)
  })

  it('keeps short and medium evidence while explicitly withholding an incomplete long window', () => {
    const s = snapshot(); s.chart.daily = s.chart.daily.slice(-40)
    const risk = buildMovementRisk(s, quote(), at)
    expect(risk.status).toBe('available')
    expect(risk.horizons[1]!.downside!.nextBoundary).toBeNull()
    expect(risk.horizons[2]).toMatchObject({ observationBars: 180, observedBars: 40, status: 'unavailable', reason: 'insufficient-daily-bars', downside: null, upside: null })
    s.chart.daily = s.chart.daily.slice(-4)
    expect(buildMovementRisk(s, quote(), at)).toMatchObject({ status: 'unavailable', reason: 'insufficient-daily-bars' })
  })

  it('does not let unavailable or retained unrelated company/derivative context erase valid price structure', () => {
    const s = snapshot()
    s.sourceHealth.push({ id: 'btc-derivatives', label: 'Context', status: 'unavailable', provider: 'context-provider', asOf: s.capturedAt,
      retained: { asOf: '2026-09-19T12:00:00Z', expiresAt: s.capturedAt, fields: ['fundingRate'] }, detail: 'Synthetic retained context' })
    expect(buildMovementRisk(s, quote(), at).status).toBe('available')
  })

  it.each(['TSLA', 'MSTR'] as const)('preserves %s disclosed delayed reference and NY weekend daily evidence', asset => {
    const s = snapshot(asset), anchor = { ...quote(asset), provider: 'yfinance', feed: 'Yahoo Finance', status: 'delayed' as const,
      asOf: '2026-09-20T11:45:00Z' }
    const risk = buildMovementRisk(s, anchor, at)
    expect(risk).toMatchObject({ status: 'available', reference: { status: 'delayed', asOf: anchor.asOf }, analysis: { dataAsOf: '2026-09-18' } })
    expect(risk.horizons[0]!.observationWindow).toContain('交易时段')
  })

  it.each(['BTC', 'TSLA'] as const)('accepts an attributed completed %s daily close without relabeling it a live quote', asset => {
    const s = snapshot(asset), anchor = movementPriceFromSnapshot(s, asset, at)!
    expect(anchor).not.toBeNull()
    expect(buildMovementRisk(s, anchor, at)).toMatchObject({ status: 'available', reference: { priceKind: 'completed-daily-close', status: 'delayed', provider: 'test-provider' } })
    expect(buildMovementRisk(s, { ...anchor, price: 101 }, at)).toMatchObject({ status: 'unavailable', reason: 'reference-close-mismatch' })
    expect(buildMovementRisk(s, { ...anchor, asOf: s.capturedAt }, at)).toMatchObject({ status: 'unavailable', reason: 'reference-close-mismatch' })
  })

  it('does not promote old trade acquisition time to a fresh price reference', () => {
    const old = { ...quote(), asOf: '2026-09-20T11:57:59Z' }
    expect(buildMovementRisk(snapshot(), old, at)).toMatchObject({ status: 'outdated', reason: 'reference-outdated' })
    expect(buildMovementRisk(snapshot('TSLA'), { ...quote('TSLA'), provider: 'yfinance', feed: 'Yahoo Finance', status: 'delayed', asOf: '2026-09-20T11:39:59Z' }, at)).toMatchObject({ status: 'outdated', reason: 'reference-outdated' })
  })

  it.each(['BTC', 'TSLA'] as const)('rejects stale %s daily structure even when the independent quote is fresh', asset => {
    const later = new Date(asset === 'BTC' ? '2026-09-22T12:00:00Z' : '2026-09-23T12:00:00Z')
    expect(buildMovementRisk(snapshot(asset), quote(asset, 100, later), later)).toMatchObject({ status: 'outdated', reason: 'daily-bars-outdated', horizons: [] })
  })

  it('rejects wrong assets, future reference/capture times and unverified daily basis', () => {
    expect(buildMovementRisk(snapshot(), quote('TSLA'), at)).toMatchObject({ reason: 'asset-mismatch', reference: null })
    expect(buildMovementRisk(snapshot(), { ...quote(), asOf: '2026-09-20T12:00:01Z' }, at)).toMatchObject({ reason: 'reference-invalid' })
    expect(buildMovementRisk(snapshot(), { ...quote(), observedAt: '2026-09-20T12:00:01Z' }, at)).toMatchObject({ reason: 'reference-invalid' })
    const future = snapshot(); future.capturedAt = '2026-09-20T12:00:01Z'
    expect(buildMovementRisk(future, quote(), at)).toMatchObject({ reason: 'snapshot-invalid' })
    const basis = snapshot(); Reflect.set(basis.analysisBasis!, 'closedBarsOnly', false)
    expect(buildMovementRisk(basis, quote(), at)).toMatchObject({ reason: 'daily-basis-unverified' })
  })

  it('rejects invalid and duplicate completed candles or unavailable/mismatched sources', () => {
    const invalid = snapshot(); invalid.chart.daily.at(-1)!.low = 101
    expect(buildMovementRisk(invalid, quote(), at)).toMatchObject({ reason: 'daily-bars-invalid' })
    const duplicate = snapshot(); duplicate.chart.daily.push({ ...duplicate.chart.daily.at(-1)! })
    expect(buildMovementRisk(duplicate, quote(), at)).toMatchObject({ reason: 'daily-bars-invalid' })
    const unavailable = snapshot(); unavailable.sourceHealth.find(s => s.id === 'daily-bars')!.status = 'unavailable'
    expect(buildMovementRisk(unavailable, quote(), at)).toMatchObject({ reason: 'daily-source-unavailable' })
    const mismatch = snapshot(); mismatch.chart.dailyMeta.symbol = 'TSLA'
    expect(buildMovementRisk(mismatch, quote(), at)).toMatchObject({ reason: 'snapshot-invalid' })
    expect(buildMovementRisk(snapshot(), { ...quote(), provider: 'alpaca', feed: 'IEX' }, at)).toMatchObject({ reason: 'reference-invalid' })
    expect(buildMovementRisk(snapshot(), { ...quote(), price: Number.NaN }, at)).toMatchObject({ reason: 'reference-invalid' })
    expect(buildMovementRisk(null, quote(), at).reason).toBe('snapshot-unavailable')
    expect(buildMovementRisk(snapshot(), null, at).reason).toBe('reference-unavailable')
  })

  it('fails closed for malformed calendar rows and future source times without guessing levels', () => {
    const malformed = snapshot(); malformed.chart.daily[0]!.date = '2026-02-31'
    expect(buildMovementRisk(malformed, quote(), at)).toMatchObject({ status: 'unavailable', reason: 'daily-bars-invalid' })
    const futureSource = snapshot(); futureSource.sourceHealth.find(s => s.id === 'daily-bars')!.asOf = '2026-09-20T12:00:01Z'
    expect(buildMovementRisk(futureSource, quote(), at)).toMatchObject({ status: 'unavailable', reason: 'daily-source-unavailable' })
    const missing = snapshot(); Reflect.set(missing.chart, 'daily', null)
    expect(buildMovementRisk(missing, quote(), at)).toMatchObject({ status: 'unavailable', reason: 'snapshot-invalid' })
  })
})
