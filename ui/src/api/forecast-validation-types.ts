// Browser mirror of the immutable forward-validation API contracts.
type JevQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> }
type JevResult = { model: string; answers: Record<string, { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }>; inputTokens: number; durationMs: number }
import type { JevHorizon } from './typesafe-types'
import type { ReturnChoice, ReturnHistory } from './forecast-experiment-types'
import type { MarketJudgmentReport } from './market-judgment'
import type { ReviewOutcome } from './market-review'
import type { MonitorAsset as MarketMonitorAsset } from './market-monitor'

export const LEGACY_FORWARD_PROTOCOL = 'market-forward-v2' as const
export const PREVIOUS_FORWARD_PROTOCOL = 'market-forward-v3' as const
export const FORWARD_PROTOCOL = 'market-forward-v4' as const
export type ForwardProtocol = typeof FORWARD_PROTOCOL | typeof PREVIOUS_FORWARD_PROTOCOL | typeof LEGACY_FORWARD_PROTOCOL
export const JEV_DECISION_POLICY = {
  id: 'jev-base-rate-v2', minHistory: 60, flatPriorCeiling: 1 / 3,
  flatExcess: 0.20, flatRatio: 2,
  // Predeclared conservative abstention guard, not fitted calibration.
  validation: 'experimental',
} as const
export type ForwardMethod = 'rules' | 'jev' | 'combined' | 'frequency' | 'alwaysUp'
export type JevDecisionReason = 'evidence-insufficient' | 'signal-uncertain' | 'history-insufficient' | 'flat-inflated' | 'answer-invalid'
export interface GuardedJevDecision {
  rawChoice: string; choice: ReturnChoice | null; reasons: JevDecisionReason[]
}
export interface ForwardPublication {
  schemaVersion: 1; protocol: ForwardProtocol; id: string; asset: MarketMonitorAsset; issuedAt: string
  policy: typeof JEV_DECISION_POLICY & { combinedProtocol: MarketJudgmentReport['protocol']; combinedDecisionPolicy: 'guarded-price-evidence-v2' | 'guarded-price-evidence-v3' }
  basis: { snapshotId: string; inputHash: string; capturedAt: string; strategyId: string; strategyVersion: number; provider: string | null }
  input: { state: Record<string, unknown>; questions: Record<string, JevQuestion>; history: Record<JevHorizon, ReturnHistory> }
  inputHash: string; rules: Record<JevHorizon, ReturnChoice | null>; combined: MarketJudgmentReport; recordHash: string
}
export interface ForwardCandidate {
  schemaVersion: 1; protocol: ForwardProtocol; publicationId: string; requestedAt: string; issuedAt: string; inputHash: string
  raw: JevResult; decisions: Record<JevHorizon, GuardedJevDecision>; recordHash: string
}
export interface ForwardRow {
  id: string; issuedAt: string; snapshotId: string; candidateAvailable: boolean; providerChanged: boolean
  /** Read-time provenance; old rows without this field remain readable. */
  cohort?: ForwardCohort
  outcomes: Array<{ horizon: JevHorizon; outcome: ReviewOutcome; actual: ReturnChoice | null
    choices: Record<ForwardMethod, ReturnChoice | null>; correct: Record<ForwardMethod, boolean | null>
    brier: { jev: number | null; frequency: number | null }
    selectedProbabilities?: { jev: number | null; frequency: number | null } }>
}
export interface ForwardSummary {
  horizon: JevHorizon; total: number; complete: number; pending: number; excluded: number; uniqueWindows: number; duplicateWindows: number
  methods: Record<ForwardMethod, { scored: number; correct: number; abstained: number }>
  probability: { count: number; jevBrier: number | null; frequencyBrier: number | null }
  matched: { count: number; correct: Record<ForwardMethod, number> }
}
export interface ForwardReport {
  protocol: ForwardProtocol; asset: MarketMonitorAsset; generatedAt: string; configured: boolean; automatic: boolean
  invalidRecords: number; historyTruncated: boolean; lastError: string | null; illustrative?: boolean
  latest: { publication: ForwardPublication; candidate: ForwardCandidate | null } | null
  rows: ForwardRow[]; summaries: ForwardSummary[]
  validation?: ForwardValidationAnalytics
}

/** Policy identity comes from the original publication, never today's label. */
export interface ForwardCohort {
  key: string; strategyId: string; strategyVersion: number; protocol: ForwardProtocol
  jevPolicy: string; combinedProtocol: string; combinedDecisionPolicy: string
}
export type ForwardComparisonStatus = 'pending' | 'insufficient' | 'no-edge' | 'unproven'
export interface ForwardPairwiseComparison {
  count: number; rulesCorrect: number; candidateCorrect: number; accuracyDifference: number | null
  disagreements: number; candidateOnlyCorrect: number; rulesOnlyCorrect: number
  nonOverlappingWindows: number; status: ForwardComparisonStatus
}
export interface ForwardCohortSummary {
  horizon: JevHorizon; total: number; pending: number; excluded: number
  uniqueWindows: number; globallySuppressedWindows: number; nonOverlappingWindows: number
  methods: Record<ForwardMethod, { scored: number; correct: number; abstained: number; unavailable: number; coverage: number | null }>
  pairwise: { jev: ForwardPairwiseComparison; combined: ForwardPairwiseComparison }
  probability: { count: number; nonOverlappingWindows: number; jevBrier: number | null; frequencyBrier: number | null; difference: number | null }
  calibration: Record<'jev' | 'frequency', { count: number; accuracy: number | null; meanSelectedProbability: number | null; probabilityGap: number | null }>
}
export interface ForwardCohortValidation {
  cohort: ForwardCohort; publications: number; summaries: ForwardCohortSummary[]
}
export interface ForwardValidationAnalytics {
  protocol: 'forward-comparison-v1'; current: ForwardCohortValidation; cohorts: ForwardCohortValidation[]
  unidentifiedRows: number
  /** Descriptive reporting gates, never a trading/promotion policy or significance test. */
  reportingGate: { commonWindows: 30; nonOverlappingWindows: 20 }
  overlappingWindowsAreIndependent: false; automaticallyChangesWeights: false
}
