import type { InvestmentExplanation, InvestmentExplanationReasonCode, InvestmentSnapshot } from '../../api/market-intelligence-types'

export type DemoExplanationScenario = 'data' | 'conflict' | 'independent' | 'model'
const scenarioReason: Record<DemoExplanationScenario, InvestmentExplanationReasonCode> = { data: 'data-unavailable', conflict: 'same-horizon-conflict', independent: 'independent-confirmation-missing', model: 'model-uncertain' }
/** Illustrative explanation categories, never a reconstructed real forecast. */
export function demoInvestmentExplanation(snapshot: InvestmentSnapshot, scenario?: DemoExplanationScenario): InvestmentExplanation {
  const defaults: Record<InvestmentSnapshot['asset'], InvestmentExplanationReasonCode[]> = {
    BTC: ['independent-confirmation-missing', 'same-horizon-conflict', 'independent-confirmation-missing'],
    TSLA: ['earnings-risk-window', 'same-horizon-conflict', 'independent-confirmation-missing'],
    MSTR: ['model-uncertain', 'data-unavailable', 'model-uncertain'],
  }
  return { protocol: 'investment-explanation-v1', asset: snapshot.asset, snapshotId: snapshot.id, marketSnapshotId: snapshot.marketSnapshotId,
    analysisTime: snapshot.analysisTime, inputStatus: 'verified',
    outlooks: snapshot.outlooks.map((row, index) => {
      const code = scenario ? scenarioReason[scenario] : defaults[snapshot.asset][index]!
      return { horizon: row.horizon, direction: row.direction, rawDirection: snapshot.rawDraft.outlooks.find(value => value.horizon === row.horizon)?.direction ?? null,
        marketDirection: null, primaryReason: code, reasons: [{ code, evidenceIds: [...row.conclusion.evidenceIds] }] }
    }) }
}
