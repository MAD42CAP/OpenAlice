import { describe, expect, it } from 'vitest'
import { buildGuardedMarketJudgment, buildMarketJudgment, buildSessionGuardedMarketJudgment } from './judgment.js'
import { judgmentSnapshot } from './judgment.fixture.js'
import type { JevReport } from './typesafe-types.js'

const at = new Date('2026-09-20T12:00:00Z')
describe('session-aware v3 judgment', () => {
  it('uses new official event provenance independently of news, without changing legacy builders', () => {
    const s = judgmentSnapshot(); s.asset = 'MSTR'; s.analysisInput = { hash: 'fixture', strategyVersion: 3 }; s.analysisBasis!.version = 3
    s.chart.intraday = s.chart.intraday.map((b, i) => ({ ...b, date: `2026-09-18T${18 + i}:00:00Z` }))
    s.analysisBasis!.hourlyAt = s.metrics.intraday.latestAt = '2026-09-18T19:00:00Z'
    s.context.nextEarningsAt = '2026-10-29'
    s.context.earningsEvent = { asset: 'MSTR', status: 'confirmed', date: '2026-10-29', timing: 'after-close', webcastAt: null,
      sourceUrl: 'https://www.strategy.com/press/synthetic-earnings', title: 'Synthetic announcement', publishedAt: '2026-09-18',
      retrievedAt: s.capturedAt, contentHash: 'b'.repeat(64), verification: 'live-official', detail: 'Synthetic source' }
    s.sourceHealth.push({ id: 'mstr-earnings', label: 'Earnings', provider: 'Strategy IR', status: 'ok', asOf: s.capturedAt,
      coverage: { earnings: 'available', news: 'not-configured' }, detail: 'Synthetic' },
    { id: 'mstr-calendar-news', label: 'News', provider: 'News', status: 'unavailable', asOf: null, detail: 'Synthetic unavailable news' })
    const legacy = buildGuardedMarketJudgment(s, at), result = buildSessionGuardedMarketJudgment(s, at)
    expect(legacy.context.earningsAt).toBeNull()
    expect(result.context.earningsAt).toBe('2026-10-29')
    expect(result.horizons.short.risks).not.toContain('calendar-unknown')
    expect(result.horizons.short.decision).toBe('directional')
    expect(buildGuardedMarketJudgment(s, at)).toEqual(legacy)
    s.context.earningsEvent.date = s.context.nextEarningsAt = '2026-09-23'
    expect(buildSessionGuardedMarketJudgment(s, at).horizons.short).toMatchObject({ decision: 'abstain', reasons: expect.arrayContaining(['earnings-near']) })
    s.sourceHealth.find(source => source.id === 'mstr-earnings')!.retained = { asOf: s.capturedAt, expiresAt: s.capturedAt, fields: ['earningsEvent'] }
    expect(buildSessionGuardedMarketJudgment(s, at).horizons.short.reasons).toContain('calendar-unknown')
  })
  it('retains the historical v2 result while withholding unverified stock hourly policy', () => {
    const s = judgmentSnapshot(); s.asset = 'MSTR'
    const old = buildGuardedMarketJudgment(s, at)
    const current = buildSessionGuardedMarketJudgment(s, at)
    expect(current).toMatchObject({ protocol: 'evidence-summary-v3', horizons: { short: { direction: 'unclear', decision: 'abstain', reasons: ['hourly-policy-unverified', ...old.horizons.short.reasons] } } })
    expect(buildGuardedMarketJudgment(s, at)).toEqual(old)
    expect(current.horizons.medium).toEqual(old.horizons.medium)
  })
  it('keeps unknown or nearby earnings out of an unconditional stock short-term call', () => {
    const s = judgmentSnapshot(); s.asset = 'TSLA'; s.analysisInput = { hash: 'fixture', strategyVersion: 3 }
    s.analysisBasis!.version = 3
    s.chart.intraday = s.chart.intraday.map((bar, i) => ({ ...bar, date: `2026-09-18T${18 + i}:00:00Z` }))
    s.analysisBasis!.hourlyAt = '2026-09-18T19:00:00Z'
    s.metrics.intraday.latestAt = s.analysisBasis!.hourlyAt
    s.sourceHealth.push({ id: 'tsla-calendar-news', label: 'Calendar', provider: 'fixture', status: 'ok', asOf: at.toISOString(), detail: 'Synthetic verified date', coverage: { earnings: 'available', news: 'matched' } })
    for (const earnings of [null, '2026-09-21', '2026-09-25']) {
      s.context.nextEarningsAt = earnings
      const result = buildSessionGuardedMarketJudgment(s, at)
      expect(result.horizons.short.decision).toBe('abstain')
      expect(result.horizons.short.reasons[0]).toBe(earnings ? 'earnings-near' : 'calendar-unknown')
    }
    s.context.nextEarningsAt = '2026-10-30'
    expect(buildSessionGuardedMarketJudgment(s, at).horizons.short).toEqual(buildGuardedMarketJudgment(s, at).horizons.short)
    const open = new Date('2026-09-21T14:00:00Z')
    expect(buildSessionGuardedMarketJudgment(s, open).horizons.short).toMatchObject({ decision: 'abstain', reasons: expect.arrayContaining(['hourly-missing']) })
  })
  it('retains BTC price evidence behavior and keeps new guards experimental', () => {
    const s = judgmentSnapshot()
    const before = structuredClone(s)
    const result = buildSessionGuardedMarketJudgment(s, at)
    expect(result.horizons).toEqual(buildGuardedMarketJudgment(s, at).horizons)
    expect(result.validation).toEqual({ status: 'experimental', policy: 'evidence-summary-v3' })
    expect(s).toEqual(before)
  })
})
describe('versioned guarded judgment', () => {
  it('keeps v1 unchanged and makes conditional evidence an abstention from return prediction', () => {
    const s = judgmentSnapshot()
    s.wyckoff!.testState = 'pending'
    const original = structuredClone(s)
    const legacy = buildMarketJudgment(s, at)
    const guarded = buildGuardedMarketJudgment(s, at)
    expect(legacy.protocol).toBe('evidence-summary-v1')
    expect(legacy.horizons.medium.decision).toBeUndefined()
    expect(guarded).toMatchObject({ protocol: 'evidence-summary-v2', validation: { status: 'experimental' }, horizons: { medium: { direction: 'bullish', decision: 'conditional' } } })
    expect(s).toEqual(original)
  })
  it('only releases a direction for fresh aligned confirmed price evidence and preserves its experimental status', () => {
    const s = judgmentSnapshot()
    const result = buildGuardedMarketJudgment(s, at)
    expect(result.horizons.medium.decision).toBe('directional')
    expect(result.validation?.status).toBe('experimental')
    expect(buildGuardedMarketJudgment(s, new Date('2026-09-24')).horizons.medium.decision).toBe('abstain')
    s.wyckoff!.phaseCandidate = 'markdown'
    s.wyckoff!.events = [{ kind: 'sign-of-weakness', status: 'confirmed', at: '2026-09-18', level: 100 }]
    expect(buildGuardedMarketJudgment(s, at).horizons.medium).toMatchObject({ direction: 'unclear', decision: 'abstain' })
  })
  it('does not turn a range or an unavailable current scan into a confident future direction', () => {
    const s = judgmentSnapshot()
    s.trend!.medium.direction = 'sideways'
    s.wyckoff!.testState = 'pending'
    expect(buildGuardedMarketJudgment(s, at).horizons.medium).toMatchObject({ direction: 'range', decision: 'abstain' })
    s.trend!.medium.direction = 'bullish'
    const failed = { id: 'failed', asset: s.asset, strategyId: s.strategyId, requestedAt: at.toISOString(), outcome: 'failed' as const, trigger: 'manual' as const }
    expect(buildGuardedMarketJudgment(s, at, null, failed).horizons.medium).toMatchObject({ direction: 'insufficient', decision: 'abstain' })
  })
})
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

it('marks unverified earnings coverage as partial without inventing a bearish vote', () => {
  const s = judgmentSnapshot(); s.asset = 'TSLA'
  for (const date of [null, 'invalid', '2026-08-01']) {
    s.context.nextEarningsAt = date
    const report = buildMarketJudgment(s, at)
    expect(report.quality).toBe('partial')
    expect(report.horizons.medium.risks).toContain('calendar-unknown')
    expect(report.horizons.medium.direction).toBe('bullish')
  }
  s.context.nextEarningsAt = '2026-10-01'
  expect(buildMarketJudgment(s, at).horizons.medium.risks).not.toContain('calendar-unknown')
})
