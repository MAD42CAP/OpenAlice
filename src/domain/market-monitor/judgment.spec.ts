import { describe, expect, it } from 'vitest'
import { buildMarketJudgment } from './judgment.js'
import { judgmentSnapshot } from './judgment.fixture.js'
import type { JevReport } from './typesafe-types.js'

const at = new Date('2026-09-20T12:00:00Z')
describe('current market evidence synthesis', () => {
  it('preserves independent outputs and never converts rule scores into probabilities', () => {
    const snapshot = judgmentSnapshot(), original = structuredClone(snapshot)
    const report = buildMarketJudgment(snapshot, at)
    expect(report.horizons.medium).toMatchObject({ direction: 'bullish', rules: 'bullish', agreement: 'aligned', sessions: 7 })
    expect(report.quality).toBe('complete')
    expect(report.context.currentFields).toContain('fundingRate')
    expect(JSON.stringify(report)).not.toMatch(/confidence|probabilities/)
    expect(snapshot).toEqual(original)
  })
  it('abstains on confirmed opposition without relabeling disagreement as a range', () => {
    const s = judgmentSnapshot()
    s.wyckoff!.phaseCandidate = 'markdown'
    s.wyckoff!.events = [{ kind: 'sign-of-weakness', status: 'confirmed', at: '2026-09-18', level: 100 }]
    const medium = buildMarketJudgment(s, at).horizons.medium
    expect(medium).toMatchObject({ direction: 'unclear', rules: 'bullish', agreement: 'mixed' })
    expect(medium.reasons[0]).toBe('structure-conflict')
    s.wyckoff!.events[0]!.status = 'candidate'
    expect(buildMarketJudgment(s, at).horizons.medium.direction).toBe('bullish')
    s.wyckoff!.events[0]!.status = 'invalidated'
    expect(buildMarketJudgment(s, at).structure.confirmed).toBe(false)
  })
  it('requires range evidence and does not turn neutral or missing data into an up call', () => {
    const s = judgmentSnapshot()
    s.trend!.medium.direction = 'sideways'; s.wyckoff!.testState = 'pending'
    expect(buildMarketJudgment(s, at).horizons.medium.direction).toBe('range')
    s.wyckoff!.range = null
    expect(buildMarketJudgment(s, at).horizons.medium.direction).toBe('unclear')
    s.trend!.medium.direction = 'insufficient'
    expect(buildMarketJudgment(s, at).horizons.medium.direction).toBe('insufficient')
  })
  it('withholds stale and unverifiable evidence even when the latest live chart has newer bars', () => {
    const s = judgmentSnapshot()
    expect(buildMarketJudgment(s, new Date('2026-09-24')).horizons.medium.direction).toBe('insufficient')
    s.analysisBasis!.dailyAt = '2026-09-01'
    expect(buildMarketJudgment(s, at).quality).toBe('insufficient')
    delete s.analysisBasis
    expect(buildMarketJudgment(s, at).horizons.long.direction).toBe('insufficient')
  })
  it('isolates missing hourly data to the short view and retains explicit fallback attribution', () => {
    const s = judgmentSnapshot(); s.chart.intraday = []
    s.sourceHealth[0]!.status = 'degraded'
    const report = buildMarketJudgment(s, at)
    expect(report.horizons.short.direction).toBe('insufficient')
    expect(report.horizons.medium.direction).toBe('bullish')
    expect(report.quality).toBe('partial')
  })
  it('keeps stale/retained background data reference-only and never treats headlines as directional votes', () => {
    const s = judgmentSnapshot()
    s.sourceHealth[2]!.retained = { asOf: '2026-09-20T11:00:00Z', expiresAt: '2026-09-20T11:30:00Z', fields: ['openInterest'] }
    s.context.recentNews = [{ title: 'Price will certainly collapse', time: at.toISOString(), source: 'synthetic' }]
    const report = buildMarketJudgment(s, at)
    expect(report.context.currentFields).toEqual([])
    expect(report.context.referenceFields).toContain('openInterest')
    expect(report.horizons.medium.direction).toBe('bullish')
    expect(report.horizons.medium.risks).toContain('context-partial')
  })
  it('keeps model direction separate and refuses foreign assets, strategies and future or stale forecasts', () => {
    const s = judgmentSnapshot()
    const row = { forecast: { asset: 'BTC', issuedAt: at.toISOString(), basis: { snapshotId: s.id, strategyId: s.strategyId }, horizons: Object.fromEntries(['short', 'medium', 'long'].map(h => [h, { answer: { choice: 'down' }, adequacy: { choice: 'adequate' } }])) }, outcomes: [{ outcome: { status: 'pending' } }] }
    const jev = { asset: 'BTC', rows: [row] } as unknown as JevReport
    expect(buildMarketJudgment(s, at, jev)).toMatchObject({ jev: { status: 'current', directions: { medium: 'down' } }, horizons: { medium: { direction: 'bullish' } } })
    row.forecast.basis.snapshotId = 'older-input'
    expect(buildMarketJudgment(s, at, jev).jev.status).toBe('different-basis')
    row.forecast.issuedAt = '2026-09-19T11:00:00Z'
    expect(buildMarketJudgment(s, at, jev).jev.status).toBe('stale')
    row.forecast.issuedAt = '2026-09-21T11:00:00Z'
    expect(buildMarketJudgment(s, at, jev).jev.status).toBe('missing')
    row.forecast.issuedAt = at.toISOString(); row.forecast.basis.strategyId = 'other'
    expect(buildMarketJudgment(s, at, jev).jev.status).toBe('missing')
  })
  it('uses equity session counts and discloses a new failed scan', () => {
    const s = judgmentSnapshot(); s.asset = 'TSLA'
    const report = buildMarketJudgment(s, at, null, { id: 'failed', asset: 'TSLA', strategyId: s.strategyId, requestedAt: at.toISOString(), outcome: 'failed', trigger: 'manual' })
    expect(report.horizons.medium.sessions).toBe(5)
    expect(report.horizons.long.sessions).toBe(20)
    expect(report.horizons.medium.risks).toContain('latest-scan-failed')
  })
  it('does not lose a same-day date-only earnings event or a Monday event on Sunday', () => {
    const s = judgmentSnapshot(); s.asset = 'TSLA'
    for (const date of ['2026-09-20', '2026-09-21']) {
      s.context.nextEarningsAt = date
      expect(buildMarketJudgment(s, at).horizons.short.risks).toContain('earnings-near')
    }
    s.sourceHealth[2]!.status = 'unavailable'
    expect(buildMarketJudgment(s, at).context.earningsAt).toBeNull()
  })
})
