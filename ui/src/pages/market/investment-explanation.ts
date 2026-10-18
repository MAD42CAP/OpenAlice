import type { MarketIntelligenceReport } from '../../api/market-intelligence'
import type { InvestmentExplanationReasonCode, InvestmentSnapshot, TrendHorizon } from '../../api/market-intelligence-types'

/** A companion explains exactly one saved analysis, never a selected older
 * snapshot or a newer technical observation. Partial quality is not a cause. */
export function boundInvestmentExplanation(report: MarketIntelligenceReport | null, snapshot: InvestmentSnapshot | null) {
  const explanation = report?.investment.explanation
  if (!report || !snapshot || !explanation || explanation.protocol !== 'investment-explanation-v1'
    || report.asset !== snapshot.asset || explanation.asset !== snapshot.asset
    || explanation.snapshotId !== snapshot.id || explanation.marketSnapshotId !== snapshot.marketSnapshotId
    || explanation.analysisTime !== snapshot.analysisTime
    || explanation.inputStatus === 'invalid' || explanation.inputStatus === 'read-error') return null
  return explanation
}

export function investmentExplanationOutlook(report: MarketIntelligenceReport | null, snapshot: InvestmentSnapshot | null, horizon: TrendHorizon) {
  const explanation = boundInvestmentExplanation(report, snapshot)
  const outlook = snapshot?.outlooks.find(row => row.horizon === horizon)
  const rows = explanation?.outlooks.filter(row => row.horizon === horizon)
  const row = rows?.length === 1 ? rows[0] : null
  return row && row.direction === outlook?.direction ? row : null
}

export function investmentPrimaryReason(report: MarketIntelligenceReport | null, snapshot: InvestmentSnapshot | null, horizon: TrendHorizon) {
  if (boundInvestmentExplanation(report, snapshot)?.inputStatus !== 'verified') return null
  const row = investmentExplanationOutlook(report, snapshot, horizon)
  return row?.primaryReason && row.primaryReason !== 'explanation-unavailable' && row.reasons.some(reason => reason.code === row.primaryReason) ? row.primaryReason : null
}

/** One coexisting factor adds specificity without claiming that a guard caused
 * a raw model abstention. All remaining factors stay in the closed details. */
export function investmentReasonKey(report: MarketIntelligenceReport | null, snapshot: InvestmentSnapshot | null, horizon: TrendHorizon): `marketExplanation.reasons.${InvestmentExplanationReasonCode}` | 'marketExplanation.modelConflict' | 'marketExplanation.modelIndependent' | null {
  const reason = investmentPrimaryReason(report, snapshot, horizon)
  if (!reason) return null
  const factors = investmentExplanationOutlook(report, snapshot, horizon)?.reasons ?? []
  if (reason === 'model-uncertain' && factors.some(row => row.code === 'same-horizon-conflict')) return 'marketExplanation.modelConflict'
  if (reason === 'model-uncertain' && factors.some(row => row.code === 'independent-confirmation-missing')) return 'marketExplanation.modelIndependent'
  return `marketExplanation.reasons.${reason}`
}

export function investmentHasNoRestriction(report: MarketIntelligenceReport | null, snapshot: InvestmentSnapshot | null, horizon: TrendHorizon) {
  const explanation = boundInvestmentExplanation(report, snapshot), row = investmentExplanationOutlook(report, snapshot, horizon)
  return explanation?.inputStatus === 'verified' && !!row && row.direction !== 'uncertain' && row.primaryReason === null
}
