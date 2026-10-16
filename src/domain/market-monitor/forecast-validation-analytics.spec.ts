import { describe, expect, it } from 'vitest'
import { analyzeForwardValidation, forwardCohort } from './forecast-validation-analytics.js'
import { FORWARD_PROTOCOL, JEV_DECISION_POLICY, type ForwardCohort, type ForwardMethod, type ForwardPublication, type ForwardRow } from './forecast-validation-types.js'
import { JEV_HORIZONS } from './typesafe-types.js'

const cohort = (strategyVersion: number): ForwardCohort => forwardCohort({ protocol: FORWARD_PROTOCOL,
  basis: { strategyId: 'evidence-chain-v1', strategyVersion } as ForwardPublication['basis'],
  policy: { ...JEV_DECISION_POLICY, combinedProtocol: 'evidence-summary-v2', combinedDecisionPolicy: 'guarded-price-evidence-v2' } })
const old = cohort(2), current = cohort(3)
function row(id: string, version = current, start = '2026-10-12', end = start): ForwardRow {
  const choices = { rules: 'down', jev: 'up', combined: 'up', frequency: 'down', alwaysUp: 'up' } as const
  return { id, issuedAt: '2026-10-11T10:00:00Z', snapshotId: id, candidateAvailable: true, providerChanged: false, cohort: version,
    outcomes: JEV_HORIZONS.map(horizon => ({ horizon, actual: 'up', choices: { ...choices },
      correct: { rules: false, jev: true, combined: true, frequency: false, alwaysUp: true },
      selectedProbabilities: { jev: 0.8, frequency: 0.7 }, brier: { jev: 0.06, frequency: 1.14 },
      outcome: { horizon: horizon === 'short' ? 'day' : horizon === 'medium' ? 'week' : 'month', trendHorizon: horizon,
        targetBars: 1, observedBars: 1, status: 'complete', direction: 'bearish', verdict: 'opposed', start, end,
        entry: 100, close: 101, changePercent: 1, highPercent: 1, lowPercent: 0, range: null } })) }
}
const short = (rows: ForwardRow[], version = current) => analyzeForwardValidation(rows, version).current.summaries[0]!
const abstain = (value: ForwardRow, method: ForwardMethod) => value.outcomes.forEach(outcome => { outcome.choices[method] = null; outcome.correct[method] = null })

describe('policy-separated incremental forward evidence', () => {
  it('compares each candidate with rules without demanding frequency or every other method', () => {
    const jev = row('jev'), combined = row('combined', current, '2026-10-13')
    abstain(jev, 'combined'); abstain(jev, 'frequency'); abstain(combined, 'jev'); abstain(combined, 'frequency')
    const report = short([jev, combined])
    expect(report.pairwise.jev).toMatchObject({ count: 1, rulesCorrect: 0, candidateCorrect: 1, disagreements: 1, status: 'insufficient' })
    expect(report.pairwise.combined).toMatchObject({ count: 1, rulesCorrect: 0, candidateCorrect: 1 })
    expect(report.methods.jev).toMatchObject({ scored: 1, abstained: 1, coverage: 0.5 })
  })

  it('deduplicates all history before filtering versions, including earlier abstentions', () => {
    const first = row('first', old); abstain(first, 'jev')
    const later = row('later'); later.issuedAt = '2026-10-11T11:00:00Z'
    const result = analyzeForwardValidation([later, first], current)
    expect(result.current.summaries[0]).toMatchObject({ uniqueWindows: 0, globallySuppressedWindows: 1, pairwise: { jev: { count: 0 } } })
    const historical = result.cohorts.find(value => value.cohort.strategyVersion === 2)!.summaries[0]!
    expect(historical).toMatchObject({ uniqueWindows: 1, methods: { jev: { scored: 0, abstained: 1 } }, probability: { count: 1, jevBrier: 0.06 } })
    expect(result.current.cohort.strategyVersion).toBe(3)
  })

  it('keeps versions and policy identities separate and never borrows historical performance for an empty current policy', () => {
    const legacy = row('old', old)
    const result = analyzeForwardValidation([legacy], current)
    expect(result.current.publications).toBe(0)
    expect(result.current.summaries.every(summary => summary.uniqueWindows === 0 && summary.methods.jev.coverage === null)).toBe(true)
    expect(result.cohorts).toHaveLength(2)
    const changed = { ...current, combinedDecisionPolicy: 'future-policy', key: 'future-policy' }
    expect(analyzeForwardValidation([row('old-policy')], changed).current.publications).toBe(0)
  })

  it('scores raw probability error on the same frequency cohort even when every Jev decision abstains', () => {
    const first = row('first'), second = row('second', current, '2026-10-13'), missing = row('missing', current, '2026-10-14')
    ;[first, second, missing].forEach(value => abstain(value, 'jev'))
    second.outcomes.forEach(outcome => { outcome.brier = { jev: 1.46, frequency: 0.2 } })
    missing.outcomes.forEach(outcome => { outcome.brier.frequency = null })
    const summary = short([first, second, missing])
    expect(summary.methods.jev).toMatchObject({ scored: 0, abstained: 3, coverage: 0 })
    expect(summary.pairwise.jev.count).toBe(0)
    expect(summary.probability.count).toBe(2)
    expect(summary.probability.jevBrier).toBeCloseTo(0.76)
    expect(summary.probability.frequencyBrier).toBeCloseTo(0.67)
    expect(summary.probability.difference).toBeCloseTo(0.09)
    expect(summary.calibration.jev).toEqual({ count: 0, accuracy: null, meanSelectedProbability: null, probabilityGap: null })
  })

  it('separates an unavailable model candidate from a saved model that actively abstained', () => {
    const missing = row('missing'), guarded = row('guarded', current, '2026-10-13')
    missing.candidateAvailable = false
    ;[missing, guarded].forEach(value => abstain(value, 'jev'))
    missing.outcomes.forEach(outcome => { outcome.brier.jev = null; outcome.selectedProbabilities!.jev = null })
    const summary = short([missing, guarded])
    expect(summary.methods.jev).toEqual({ scored: 0, correct: 0, abstained: 1, unavailable: 1, coverage: 0 })
    expect(summary.probability.count).toBe(1)
    expect(summary.calibration.jev.count).toBe(0)
    expect(summary.pairwise.jev.count).toBe(0)
  })

  it('reports calibration on the exact selected-probability and realised-hit cohort', () => {
    const first = row('first'), second = row('second', current, '2026-10-13'), noProbability = row('no-probability', current, '2026-10-14')
    second.outcomes.forEach(outcome => { outcome.correct.jev = false; outcome.selectedProbabilities!.jev = 0.6 })
    noProbability.outcomes.forEach(outcome => { outcome.selectedProbabilities!.jev = null })
    const summary = short([first, second, noProbability])
    expect(summary.methods.jev.scored).toBe(3)
    expect(summary.calibration.jev.count).toBe(2)
    expect(summary.calibration.jev.accuracy).toBe(0.5)
    expect(summary.calibration.jev.meanSelectedProbability).toBeCloseTo(0.7)
    expect(summary.calibration.jev.probabilityGap).toBeCloseTo(0.2)
  })

  it('keeps unfinished and unverified windows out of every error and hit denominator', () => {
    const pending = row('pending'), invalid = row('invalid', current, '2026-10-13')
    pending.outcomes.forEach(outcome => { outcome.outcome.status = 'pending' })
    invalid.outcomes.forEach(outcome => { outcome.outcome.status = 'unverified' })
    const summary = short([pending, invalid])
    expect(summary).toMatchObject({ total: 2, pending: 1, excluded: 1, uniqueWindows: 0, probability: { count: 0 }, pairwise: { jev: { count: 0, status: 'pending' } } })
    expect(summary.methods.jev).toMatchObject({ scored: 0, correct: 0, abstained: 0, coverage: null })
  })

  it('reports non-overlapping windows separately and never calls a small perfect run an edge', () => {
    const first = row('first', current, '2026-10-12', '2026-10-18')
    const second = row('second', current, '2026-10-13', '2026-10-19')
    const third = row('third', current, '2026-10-19', '2026-10-25')
    const summary = short([third, first, second])
    expect(summary.uniqueWindows).toBe(3)
    expect(summary.nonOverlappingWindows).toBe(2)
    expect(summary.pairwise.jev).toMatchObject({ count: 3, candidateCorrect: 3, accuracyDifference: 1, nonOverlappingWindows: 2, status: 'insufficient' })
  })

  it('keeps larger observed improvements unproven and labels no gain descriptively without changing weights', () => {
    const rows = Array.from({ length: 30 }, (_, index) => row(String(index), current, new Date(Date.parse('2026-08-01') + index * 86_400_000).toISOString().slice(0, 10)))
    const improved = analyzeForwardValidation(rows, current)
    expect(improved.current.summaries[0]!.pairwise.jev.status).toBe('unproven')
    rows.forEach(value => value.outcomes.forEach(outcome => { outcome.correct.rules = true; outcome.choices.rules = 'up' }))
    const unchanged = analyzeForwardValidation(rows, current)
    expect(unchanged.current.summaries[0]!.pairwise.jev.status).toBe('no-edge')
    expect(unchanged).toMatchObject({ automaticallyChangesWeights: false, overlappingWindowsAreIndependent: false })
  })
})
