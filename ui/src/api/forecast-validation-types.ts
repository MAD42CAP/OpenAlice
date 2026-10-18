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
export const JEV_DECISION_REASONS = ['evidence-insufficient', 'signal-uncertain', 'history-insufficient', 'flat-inflated', 'answer-invalid'] as const
export type JevDecisionReason = typeof JEV_DECISION_REASONS[number]
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
/** Read-only inspection of the original model answers, never a replacement for
 * the effective guarded decision or a new historical forecast. */
export interface ForwardJevOutcomeDiagnostics {
  rawAnswerValid: boolean; rawChoice: ReturnChoice | null; rawCorrect: boolean | null; rawSelectedProbability: number | null
  evidence: { valid: boolean; choice: 'adequate' | 'insufficient' | null }
  signal: { valid: boolean; choice: 'supported' | 'uncertain' | null }
  reasons: JevDecisionReason[]
}
export interface ForwardRow {
  id: string; issuedAt: string; snapshotId: string; candidateAvailable: boolean; providerChanged: boolean
  /** Read-time provenance; old rows without this field remain readable. */
  cohort?: ForwardCohort
  outcomes: Array<{ horizon: JevHorizon; outcome: ReviewOutcome; actual: ReturnChoice | null
    choices: Record<ForwardMethod, ReturnChoice | null>; correct: Record<ForwardMethod, boolean | null>
    brier: { jev: number | null; frequency: number | null }
    selectedProbabilities?: { jev: number | null; frequency: number | null }
    jevDiagnostics?: ForwardJevOutcomeDiagnostics }>
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
export interface ForwardRawJevScore {
  scored: number; correct: number; unavailable: number; coverage: number | null; accuracy: number | null
}
export interface ForwardRawJevComparison {
  baseline: 'rules' | 'frequency'; count: number; rawCorrect: number; baselineCorrect: number; accuracyDifference: number | null
  disagreements: number; rawOnlyCorrect: number; baselineOnlyCorrect: number
  nonOverlappingWindows: number; status: ForwardComparisonStatus
}
export interface ForwardJevDiagnosticsSummary {
  protocol: 'jev-abstention-audit-v1'
  /** Flags can overlap: one publication may have multiple abstention reasons. */
  reasonCountsOverlap: true
  published: { total: number; candidateAvailable: number; unavailable: number; diagnosticsUnavailable: number
    invalidRawAnswers: number; guardedAbstained: number; reasonCounts: Record<JevDecisionReason, number> }
  matured: { uniqueWindows: number; raw: ForwardRawJevScore; guardedAbstainedRaw: ForwardRawJevScore
    rawVsRules: ForwardRawJevComparison; rawVsFrequency: ForwardRawJevComparison }
  byReason: Array<{ reason: JevDecisionReason; published: number; pending: number; excluded: number; uniqueWindows: number
    raw: ForwardRawJevScore
    probability: { count: number; jevBrier: number | null; frequencyBrier: number | null; difference: number | null } }>
}
export interface ForwardCohortSummary {
  horizon: JevHorizon; total: number; pending: number; excluded: number
  uniqueWindows: number; globallySuppressedWindows: number; nonOverlappingWindows: number
  methods: Record<ForwardMethod, { scored: number; correct: number; abstained: number; unavailable: number; coverage: number | null }>
  pairwise: { jev: ForwardPairwiseComparison; combined: ForwardPairwiseComparison }
  probability: { count: number; nonOverlappingWindows: number; jevBrier: number | null; frequencyBrier: number | null; difference: number | null }
  calibration: Record<'jev' | 'frequency', { count: number; accuracy: number | null; meanSelectedProbability: number | null; probabilityGap: number | null }>
  jevDiagnostics: ForwardJevDiagnosticsSummary
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
