import type { InvestmentSnapshot } from '../../api/market-intelligence-types'
import type { NativeForwardReport } from '../../api/native-forward-types'

/** Invented pending records only; no real native predictive performance. */
export function demoNativeForward(snapshot: InvestmentSnapshot): NativeForwardReport {
  const asset = snapshot.asset
  const basis = { snapshotId: snapshot.marketSnapshotId, inputHash: snapshot.inputHash, strategyId: 'evidence-chain-v1', strategyVersion: 4, provider: asset === 'BTC' ? 'coinbase' : 'alpaca' }
  const summaries = (['short', 'medium', 'long'] as const).map((horizon, index) => ({ horizon, sessions: (asset === 'BTC' ? [1, 7, 30] : [1, 5, 20])[index]!, total: 1, pending: 1, excluded: 0, uniqueWindows: 0, suppressedWindows: 0,
    unconditional: { scored: 0, correct: 0 }, conditionalIntent: { scored: 0, correct: 0 }, abstained: 0,
    conditions: { defined: 0, confirmationTriggered: 0, invalidationTriggered: 0, bothTriggered: 0 } }))
  const current = { analysisVersion: snapshot.analysisVersion, strategyId: basis.strategyId, strategyVersion: basis.strategyVersion, summaries }
  return { protocol: 'native-investment-forward-v1', asset, generatedAt: snapshot.analysisTime, asOf: snapshot.analysisTime,
    historyTruncated: false, rowsTruncated: false, invalidRecords: 0, orphanedRecords: 0, excludedSessions: [], current, cohorts: [current],
    rows: [{ publicationId: `${snapshot.id}-forward`, issuedAt: snapshot.analysisTime, analysisVersion: snapshot.analysisVersion, basis,
      outcomeSnapshotId: null, outcomeProvider: null, providerChanged: false,
      outcomes: summaries.map(row => { const outlook = snapshot.outlooks.find(value => value.horizon === row.horizon)!
        const intent = outlook.direction.includes('bullish') ? 'up' as const : outlook.direction.includes('bearish') ? 'down' as const : null
        return { horizon: row.horizon, sessions: row.sessions, status: 'pending', start: null, end: null, entry: null, close: null, changePercent: null,
          actual: null, intent, intentKind: !intent ? 'abstain' : outlook.direction.startsWith('conditional-') ? 'conditional' : 'unconditional', correct: null,
          conditions: { defined: !!outlook.decisionConditions, confirmationAt: null, invalidationAt: null } }
      }) }],
    note: 'Illustrative frozen native synthesis; pending outcomes are not a win rate.' }
}
