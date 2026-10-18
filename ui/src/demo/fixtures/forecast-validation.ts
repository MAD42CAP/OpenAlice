import type { MonitorAsset } from '../../api/market-monitor'
import { FORWARD_PROTOCOL, LEGACY_FORWARD_PROTOCOL, JEV_DECISION_POLICY, JEV_DECISION_REASONS, type ForwardProtocol, type ForwardReport, type ForwardJevDiagnosticsSummary } from '../../api/forecast-validation-types'
import { demoForecastExperiment } from './forecast-experiment'
import { demoMarketJudgment } from './market-judgment'

/** Illustrative frozen records; never actual model performance. */
export function demoForecastValidation(asset: MonitorAsset, protocol: ForwardProtocol = FORWARD_PROTOCOL): ForwardReport {
  const experiment = demoForecastExperiment(asset), previous = experiment.latest!
  const original = previous.publication.original, issuedAt = original.issuedAt
  const strategyVersion = protocol === FORWARD_PROTOCOL ? 4 : protocol !== LEGACY_FORWARD_PROTOCOL ? 3 : 2
  const horizons = ['short', 'medium', 'long'] as const
  const methods = ['rules', 'jev', 'combined', 'frequency', 'alwaysUp'] as const
  const combined = demoMarketJudgment(asset, protocol !== LEGACY_FORWARD_PROTOCOL ? 'v3' : 'v2')
  const candidate: NonNullable<NonNullable<ForwardReport['latest']>['candidate']> = {
    schemaVersion: 1, protocol, publicationId: `demo-${protocol}`, requestedAt: issuedAt, issuedAt, inputHash: 'illustrative', recordHash: 'illustrative',
    raw: { model: original.model, inputTokens: 0, durationMs: 0, answers: { short: { type: 'choice', choice: 'flat', confidence: 0.8, probabilities: { up: 0.1, flat: 0.8, down: 0.1 } }, medium: { type: 'choice', choice: 'flat', confidence: 0.6, probabilities: { up: 0.2, flat: 0.6, down: 0.2 } }, long: { type: 'choice', choice: 'up', confidence: 0.55, probabilities: { up: 0.55, flat: 0.05, down: 0.4 } } } },
    decisions: { short: { rawChoice: 'flat', choice: null, reasons: ['flat-inflated'] }, medium: { rawChoice: 'flat', choice: null, reasons: ['signal-uncertain'] }, long: { rawChoice: 'up', choice: 'up', reasons: [] } },
  }
  for (const horizon of horizons) {
    candidate.raw.answers[`${horizon}Evidence`] = { type: 'choice', choice: 'adequate', confidence: 0.9, probabilities: { adequate: 0.9, insufficient: 0.1 } }
    const uncertain = candidate.decisions[horizon].reasons.includes('signal-uncertain')
    candidate.raw.answers[`${horizon}Signal`] = { type: 'choice', choice: uncertain ? 'uncertain' : 'supported', confidence: 0.9, probabilities: uncertain ? { supported: 0.1, uncertain: 0.9 } : { supported: 0.9, uncertain: 0.1 } }
  }
  const report: ForwardReport = {
    protocol, asset, generatedAt: issuedAt, configured: true, automatic: false, invalidRecords: 0, historyTruncated: false, lastError: null, illustrative: true,
    latest: { publication: { schemaVersion: 1, protocol, id: `demo-${protocol}`, asset, issuedAt, policy: { ...JEV_DECISION_POLICY, combinedProtocol: combined.protocol, combinedDecisionPolicy: protocol !== LEGACY_FORWARD_PROTOCOL ? 'guarded-price-evidence-v3' : 'guarded-price-evidence-v2' },
      basis: { ...original.basis, strategyVersion, provider: asset === 'BTC' ? 'coinbase' : 'alpaca' }, input: { state: {}, questions: original.questions, history: previous.candidate!.history },
      inputHash: 'illustrative', rules: { short: 'up', medium: 'up', long: 'up' }, combined, recordHash: 'illustrative' }, candidate },
    rows: [{ id: `demo-${protocol}`, issuedAt, snapshotId: original.basis.snapshotId, candidateAvailable: true, providerChanged: false,
      outcomes: experiment.rows[0]!.outcomes.map(row => ({ ...row, choices: { rules: 'up', jev: candidate.decisions[row.horizon].choice, combined: null, frequency: 'up', alwaysUp: 'up' },
        correct: { rules: null, jev: null, combined: null, frequency: null, alwaysUp: null }, brier: { jev: null, frequency: null } })) }],
    summaries: horizons.map(horizon => ({ horizon, total: 1, complete: 0, pending: 1, excluded: 0, uniqueWindows: 0, duplicateWindows: 0,
      methods: Object.fromEntries(methods.map(method => [method, { scored: 0, correct: 0, abstained: 0 }])) as ForwardReport['summaries'][number]['methods'],
      probability: { count: 0, jevBrier: null, frequencyBrier: null }, matched: { count: 0, correct: { rules: 0, jev: 0, combined: 0, frequency: 0, alwaysUp: 0 } } })),
  }
  report.rows.forEach(row => row.outcomes.forEach(outcome => {
    const answer = candidate.raw.answers[outcome.horizon]!, decision = candidate.decisions[outcome.horizon]
    outcome.jevDiagnostics = { rawAnswerValid: true, rawChoice: answer.choice as 'up' | 'flat' | 'down', rawCorrect: null,
      rawSelectedProbability: answer.probabilities[answer.choice]!, evidence: { valid: true, choice: 'adequate' },
      signal: { valid: true, choice: decision.reasons.includes('signal-uncertain') ? 'uncertain' : 'supported' }, reasons: [...decision.reasons] }
  }))
  if (protocol === FORWARD_PROTOCOL) {
    const identity = { protocol, strategyId: original.basis.strategyId, strategyVersion, jevPolicy: JEV_DECISION_POLICY.id, combinedProtocol: combined.protocol, combinedDecisionPolicy: 'guarded-price-evidence-v3' }
    const cohort = { key: JSON.stringify(identity), ...identity }
    report.rows.forEach(row => { row.cohort = cohort })
    const diagnostic = (horizon: typeof horizons[number]): ForwardJevDiagnosticsSummary => {
      const reasons = candidate.decisions[horizon].reasons
      const raw = { scored: 0, correct: 0, unavailable: 0, coverage: null, accuracy: null }
      const pair = { count: 0, rawCorrect: 0, baselineCorrect: 0, accuracyDifference: null, disagreements: 0, rawOnlyCorrect: 0, baselineOnlyCorrect: 0, nonOverlappingWindows: 0, status: 'pending' as const }
      return { protocol: 'jev-abstention-audit-v1', reasonCountsOverlap: true,
        published: { total: 1, candidateAvailable: 1, unavailable: 0, diagnosticsUnavailable: 0, invalidRawAnswers: 0, guardedAbstained: candidate.decisions[horizon].choice === null ? 1 : 0,
          reasonCounts: Object.fromEntries(JEV_DECISION_REASONS.map(reason => [reason, reasons.includes(reason) ? 1 : 0])) as ForwardJevDiagnosticsSummary['published']['reasonCounts'] },
        matured: { uniqueWindows: 0, raw: { ...raw }, guardedAbstainedRaw: { ...raw }, rawVsRules: { ...pair, baseline: 'rules' }, rawVsFrequency: { ...pair, baseline: 'frequency' } },
        byReason: JEV_DECISION_REASONS.map(reason => ({ reason, published: reasons.includes(reason) ? 1 : 0, pending: reasons.includes(reason) ? 1 : 0, excluded: 0, uniqueWindows: 0, raw: { ...raw }, probability: { count: 0, jevBrier: null, frequencyBrier: null, difference: null } })) }
    }
    const pair = { count: 0, rulesCorrect: 0, candidateCorrect: 0, accuracyDifference: null, disagreements: 0, candidateOnlyCorrect: 0, rulesOnlyCorrect: 0, nonOverlappingWindows: 0, status: 'pending' as const }
    const current = { cohort, publications: 1, summaries: report.summaries.map(row => ({ horizon: row.horizon, total: 1, pending: 1, excluded: 0, uniqueWindows: 0, globallySuppressedWindows: 0, nonOverlappingWindows: 0,
      methods: Object.fromEntries(methods.map(method => [method, { scored: 0, correct: 0, abstained: 0, unavailable: 0, coverage: null }])) as NonNullable<ForwardReport['validation']>['current']['summaries'][number]['methods'],
      pairwise: { jev: { ...pair }, combined: { ...pair } }, probability: { count: 0, nonOverlappingWindows: 0, jevBrier: null, frequencyBrier: null, difference: null }, jevDiagnostics: diagnostic(row.horizon),
      calibration: { jev: { count: 0, accuracy: null, meanSelectedProbability: null, probabilityGap: null }, frequency: { count: 0, accuracy: null, meanSelectedProbability: null, probabilityGap: null } } })) }
    report.validation = { protocol: 'forward-comparison-v1', current, cohorts: [current], unidentifiedRows: 0, reportingGate: { commonWindows: 30, nonOverlappingWindows: 20 }, overlappingWindowsAreIndependent: false, automaticallyChangesWeights: false }
  }
  return report
}
