import type { MonitorAsset } from '../../api/market-monitor'
import { EXPERIMENT_PROTOCOL, type ExperimentReport } from '../../api/forecast-experiment-types'
import { demoJevReport } from './typesafe'
import { demoMarketJudgment } from './market-judgment'

export function demoForecastExperiment(asset: MonitorAsset): ExperimentReport {
  const jev = demoJevReport(asset), original = jev.rows[0]!.forecast, combined = demoMarketJudgment(asset), issuedAt = original.issuedAt
  const horizons = ['short', 'medium', 'long'] as const
  const methods = ['original', 'challenger', 'rules', 'combined', 'frequency', 'alwaysUp'] as const
  const history = Object.fromEntries(horizons.map(h => [h, { sessions: original.horizons[h].bars, samples: 120, firstEntryAt: '2026-04-01', lastExitAt: '2026-09-19', meanPercent: 0.1, volatilityPercent: 2.5, medianAbsolutePercent: 1.2, probabilities: { up: 0.52, flat: 0.06, down: 0.42 } }])) as NonNullable<NonNullable<ExperimentReport['latest']>['candidate']>['history']
  const row: ExperimentReport['rows'][number] = { id: 'demo-comparison', issuedAt, snapshotId: original.basis.snapshotId, providerChanged: false, candidateAvailable: true,
    outcomes: jev.rows[0]!.outcomes.map(o => ({ horizon: o.horizon, outcome: o.outcome, actual: null,
      choices: { original: 'down', challenger: 'up', rules: 'up', combined: 'up', frequency: 'up', alwaysUp: 'up' },
      correct: Object.fromEntries(methods.map(m => [m, null])) as Record<typeof methods[number], null>, brier: { original: null, challenger: null, frequency: null } })) }
  return { protocol: EXPERIMENT_PROTOCOL, asset, generatedAt: issuedAt, configured: true, automatic: false, illustrative: true, invalidRecords: 0, historyTruncated: false, lastError: null,
    latest: { publication: { protocol: EXPERIMENT_PROTOCOL, id: row.id, asset, issuedAt, recordHash: 'illustrative', original, combined },
      candidate: { protocol: EXPERIMENT_PROTOCOL, publicationId: row.id, issuedAt, recordHash: 'illustrative', inputHash: 'illustrative', state: {}, questions: {}, history,
        result: { model: original.model, inputTokens: 0, durationMs: 0, answers: { breakout: { type: 'choice', choice: 'inside', confidence: 1, probabilities: { up: 0, down: 0, inside: 1 } }, hold: { type: 'choice', choice: 'not_applicable', confidence: 1, probabilities: { held: 0, failed: 0, not_applicable: 1 } }, participation: { type: 'choice', choice: 'above', confidence: 1, probabilities: { above: 1, not_above: 0, unavailable: 0 } } } } } },
    rows: [row], summaries: horizons.map(horizon => ({ horizon, total: 1, complete: 0, pending: 1, excluded: 0, uniqueWindows: 0, duplicateWindows: 0,
      methods: Object.fromEntries(methods.map(m => [m, { scored: 0, correct: 0 }])) as ExperimentReport['summaries'][number]['methods'],
      paired: { count: 0, originalCorrect: 0, challengerCorrect: 0, originalBrier: null, challengerBrier: null, frequencyBrier: null } })) }
}
