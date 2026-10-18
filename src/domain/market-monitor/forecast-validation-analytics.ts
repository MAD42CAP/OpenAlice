import { firstPerOutcomeWindow } from './review-cohort.js'
import { JEV_HORIZONS } from './typesafe-types.js'
import { JEV_DECISION_REASONS, type ForwardCohort, type ForwardCohortSummary, type ForwardCohortValidation, type ForwardJevDiagnosticsSummary, type ForwardMethod, type ForwardPairwiseComparison, type ForwardPublication, type ForwardRawJevComparison, type ForwardRawJevScore, type ForwardRow, type ForwardValidationAnalytics } from './forecast-validation-types.js'

const methods: ForwardMethod[] = ['rules', 'jev', 'combined', 'frequency', 'alwaysUp']
/** A reporting gate only: exceeding it does not establish independence,
 * significance, a validated strategy or permission to increase model weight. */
const reportingGate = { commonWindows: 30, nonOverlappingWindows: 20 } as const
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null

type Window = ForwardRow['outcomes'][number] & { issuedAt: string; cohort?: ForwardCohort; candidateAvailable: boolean }

export function forwardCohort(publication: { protocol: ForwardPublication['protocol']; basis: Pick<ForwardPublication['basis'], 'strategyId' | 'strategyVersion'>; policy: Pick<ForwardPublication['policy'], 'id' | 'combinedProtocol' | 'combinedDecisionPolicy'> }): ForwardCohort {
  const { strategyId, strategyVersion } = publication.basis
  const { id: jevPolicy, combinedProtocol, combinedDecisionPolicy } = publication.policy
  const identity = { protocol: publication.protocol, strategyId, strategyVersion, jevPolicy, combinedProtocol, combinedDecisionPolicy }
  return { key: JSON.stringify(identity), ...identity }
}

/** Greedy earliest-finish interval selection supplies an auxiliary count, not
 * an independent-trades claim. Windows sharing any outcome date still overlap. */
function nonOverlapping(windows: Window[]): number {
  let lastEnd = -Infinity, count = 0
  for (const window of windows.slice().sort((a, b) => (a.outcome.end ?? '').localeCompare(b.outcome.end ?? '') || (a.outcome.start ?? '').localeCompare(b.outcome.start ?? '') || a.issuedAt.localeCompare(b.issuedAt))) {
    const start = Date.parse(window.outcome.start ?? ''), end = Date.parse(window.outcome.end ?? '')
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start <= lastEnd) continue
    count++; lastEnd = end
  }
  return count
}

function pairwise(unique: Window[], pending: number, candidate: 'jev' | 'combined'): ForwardPairwiseComparison {
  // Each pair has its own denominator: frequency, the other candidate and
  // always-up availability cannot silently remove a valid common call.
  const paired = unique.filter(row => row.correct.rules !== null && row.correct[candidate] !== null)
  const count = paired.length, rulesCorrect = paired.filter(row => row.correct.rules).length
  const candidateCorrect = paired.filter(row => row.correct[candidate]).length, nonOverlappingWindows = nonOverlapping(paired)
  const status = !count && pending ? 'pending'
    : count < reportingGate.commonWindows || nonOverlappingWindows < reportingGate.nonOverlappingWindows ? 'insufficient'
      : candidateCorrect <= rulesCorrect ? 'no-edge' : 'unproven'
  return { count, rulesCorrect, candidateCorrect, accuracyDifference: count ? (candidateCorrect - rulesCorrect) / count : null,
    disagreements: paired.filter(row => row.choices.rules !== row.choices[candidate]).length,
    candidateOnlyCorrect: paired.filter(row => row.correct[candidate] === true && row.correct.rules === false).length,
    rulesOnlyCorrect: paired.filter(row => row.correct.rules === true && row.correct[candidate] === false).length,
    nonOverlappingWindows, status }
}

const scoredRaw = (row: Window) => row.jevDiagnostics?.rawAnswerValid === true
  && row.jevDiagnostics.rawChoice !== null && row.jevDiagnostics.rawCorrect !== null

function rawScore(windows: Window[]): ForwardRawJevScore {
  const scored = windows.filter(scoredRaw), count = scored.length
  const correct = scored.filter(row => row.jevDiagnostics!.rawCorrect === true).length
  return { scored: count, correct, unavailable: windows.length - count,
    coverage: windows.length ? count / windows.length : null, accuracy: count ? correct / count : null }
}

function rawPairwise(unique: Window[], pending: number, baseline: 'rules' | 'frequency'): ForwardRawJevComparison {
  const paired = unique.filter(row => scoredRaw(row) && row.correct[baseline] !== null)
  const count = paired.length, rawCorrect = paired.filter(row => row.jevDiagnostics!.rawCorrect === true).length
  const baselineCorrect = paired.filter(row => row.correct[baseline] === true).length, nonOverlappingWindows = nonOverlapping(paired)
  const status = !count && pending ? 'pending'
    : count < reportingGate.commonWindows || nonOverlappingWindows < reportingGate.nonOverlappingWindows ? 'insufficient'
      : rawCorrect <= baselineCorrect ? 'no-edge' : 'unproven'
  return { baseline, count, rawCorrect, baselineCorrect, accuracyDifference: count ? (rawCorrect - baselineCorrect) / count : null,
    disagreements: paired.filter(row => row.jevDiagnostics!.rawChoice !== row.choices[baseline]).length,
    rawOnlyCorrect: paired.filter(row => row.jevDiagnostics!.rawCorrect === true && row.correct[baseline] === false).length,
    baselineOnlyCorrect: paired.filter(row => row.jevDiagnostics!.rawCorrect === false && row.correct[baseline] === true).length,
    nonOverlappingWindows, status }
}

/** Diagnosis uses the already globally selected windows. Filtering each reason
 * first would let a later rejected call replace the original call's outcome. */
function jevDiagnostics(local: Window[], unique: Window[], pending: number): ForwardJevDiagnosticsSummary {
  const hasReason = (row: Window, reason: typeof JEV_DECISION_REASONS[number]) => row.candidateAvailable && row.jevDiagnostics?.reasons.includes(reason) === true
  return { protocol: 'jev-abstention-audit-v1', reasonCountsOverlap: true,
    published: { total: local.length, candidateAvailable: local.filter(row => row.candidateAvailable).length,
      unavailable: local.filter(row => !row.candidateAvailable).length,
      diagnosticsUnavailable: local.filter(row => row.candidateAvailable && !row.jevDiagnostics).length,
      invalidRawAnswers: local.filter(row => row.candidateAvailable && row.jevDiagnostics?.rawAnswerValid === false).length,
      guardedAbstained: local.filter(row => row.candidateAvailable && row.choices.jev === null).length,
      reasonCounts: Object.fromEntries(JEV_DECISION_REASONS.map(reason => [reason, local.filter(row => hasReason(row, reason)).length])) as ForwardJevDiagnosticsSummary['published']['reasonCounts'] },
    matured: { uniqueWindows: unique.length, raw: rawScore(unique),
      guardedAbstainedRaw: rawScore(unique.filter(row => row.candidateAvailable && row.choices.jev === null)),
      rawVsRules: rawPairwise(unique, pending, 'rules'), rawVsFrequency: rawPairwise(unique, pending, 'frequency') },
    byReason: JEV_DECISION_REASONS.map(reason => {
      const published = local.filter(row => hasReason(row, reason)), windows = unique.filter(row => hasReason(row, reason))
      const probability = windows.filter(row => row.jevDiagnostics?.rawAnswerValid && row.brier.jev !== null && row.brier.frequency !== null)
      const jevBrier = mean(probability.map(row => row.brier.jev!)), frequencyBrier = mean(probability.map(row => row.brier.frequency!))
      return { reason, published: published.length, pending: published.filter(row => row.outcome.status === 'pending').length,
        excluded: published.filter(row => row.outcome.status === 'unverified' || row.outcome.status === 'missing-data').length,
        uniqueWindows: windows.length, raw: rawScore(windows),
        probability: { count: probability.length, jevBrier, frequencyBrier,
          difference: jevBrier === null || frequencyBrier === null ? null : jevBrier - frequencyBrier } }
    }) }
}

/** All-history deduplication precedes policy/cohort filtering. A later policy
 * must not replace the original forecast for the very same realised window. */
export function analyzeForwardValidation(rows: ForwardRow[], currentCohort: ForwardCohort): ForwardValidationAnalytics {
  const identities = new Map<string, ForwardCohort>([[currentCohort.key, currentCohort]])
  rows.forEach(row => { if (row.cohort) identities.set(row.cohort.key, row.cohort) })
  const cohorts = [...identities.values()].map((cohort): ForwardCohortValidation => {
    const summaries = JEV_HORIZONS.map((horizon): ForwardCohortSummary => {
      const all: Window[] = rows.flatMap(row => row.outcomes.filter(outcome => outcome.horizon === horizon).map(outcome => ({ ...outcome, issuedAt: row.issuedAt, cohort: row.cohort, candidateAvailable: row.candidateAvailable })))
      const local = all.filter(row => row.cohort?.key === cohort.key)
      const complete = all.filter(row => row.outcome.status === 'complete')
      const unique = firstPerOutcomeWindow(complete, row => ({ issuedAt: row.issuedAt, ...row.outcome })).filter(row => row.cohort?.key === cohort.key)
      const pending = local.filter(row => row.outcome.status === 'pending').length
      const probability = unique.filter(row => row.brier.jev !== null && row.brier.frequency !== null)
      const jevBrier = mean(probability.map(row => row.brier.jev!)), frequencyBrier = mean(probability.map(row => row.brier.frequency!))
      const calibration = (method: 'jev' | 'frequency') => {
        const scored = unique.filter(row => row.correct[method] !== null && typeof row.selectedProbabilities?.[method] === 'number' && Number.isFinite(row.selectedProbabilities[method]))
        const accuracy = mean(scored.map(row => row.correct[method] ? 1 : 0))
        const meanSelectedProbability = mean(scored.map(row => row.selectedProbabilities![method]!))
        return { count: scored.length, accuracy, meanSelectedProbability,
          probabilityGap: accuracy === null || meanSelectedProbability === null ? null : meanSelectedProbability - accuracy }
      }
      return { horizon, total: local.length, pending,
        excluded: local.filter(row => row.outcome.status === 'unverified' || row.outcome.status === 'missing-data').length,
        uniqueWindows: unique.length, globallySuppressedWindows: local.filter(row => row.outcome.status === 'complete').length - unique.length,
        nonOverlappingWindows: nonOverlapping(unique),
        methods: Object.fromEntries(methods.map(method => { const scored = unique.filter(row => row.correct[method] !== null).length
          return [method, { scored, correct: unique.filter(row => row.correct[method] === true).length,
            abstained: unique.filter(row => row.choices[method] === null && (method !== 'jev' || row.candidateAvailable)).length,
            unavailable: method === 'jev' ? unique.filter(row => !row.candidateAvailable).length : 0, coverage: unique.length ? scored / unique.length : null }]
        })) as ForwardCohortSummary['methods'],
        pairwise: { jev: pairwise(unique, local.length ? pending : 1, 'jev'), combined: pairwise(unique, local.length ? pending : 1, 'combined') },
        probability: { count: probability.length, nonOverlappingWindows: nonOverlapping(probability), jevBrier, frequencyBrier,
          difference: jevBrier === null || frequencyBrier === null ? null : jevBrier - frequencyBrier },
        calibration: { jev: calibration('jev'), frequency: calibration('frequency') },
        jevDiagnostics: jevDiagnostics(local, unique, local.length ? pending : 1) }
    })
    return { cohort, publications: rows.filter(row => row.cohort?.key === cohort.key).length, summaries }
  })
  return { protocol: 'forward-comparison-v1', current: cohorts.find(cohort => cohort.cohort.key === currentCohort.key)!, cohorts,
    unidentifiedRows: rows.filter(row => !row.cohort).length, reportingGate, overlappingWindowsAreIndependent: false, automaticallyChangesWeights: false }
}
