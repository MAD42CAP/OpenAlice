import { firstPerOutcomeWindow } from './review-cohort.js'
import { JEV_HORIZONS } from './typesafe-types.js'
import type { ForwardCohort, ForwardCohortSummary, ForwardCohortValidation, ForwardMethod, ForwardPairwiseComparison, ForwardPublication, ForwardRow, ForwardValidationAnalytics } from './forecast-validation-types.js'

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
        calibration: { jev: calibration('jev'), frequency: calibration('frequency') } }
    })
    return { cohort, publications: rows.filter(row => row.cohort?.key === cohort.key).length, summaries }
  })
  return { protocol: 'forward-comparison-v1', current: cohorts.find(cohort => cohort.cohort.key === currentCohort.key)!, cohorts,
    unidentifiedRows: rows.filter(row => !row.cohort).length, reportingGate, overlappingWindowsAreIndependent: false, automaticallyChangesWeights: false }
}
