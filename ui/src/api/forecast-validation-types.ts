// Browser mirror of the frozen forward-validation contracts.
type JevQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> }
type JevResult = { model: string; answers: Record<string, { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }>; inputTokens: number; durationMs: number }
import type { JevHorizon } from './typesafe-types'
import type { ReturnChoice, ReturnHistory } from './forecast-experiment-types'
import type { MarketJudgmentReport } from './market-judgment'
import type { ReviewOutcome } from './market-review'
import type { MonitorAsset as MarketMonitorAsset } from './market-monitor'

export const FORWARD_PROTOCOL = 'market-forward-v2' as const
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
  schemaVersion: 1; protocol: typeof FORWARD_PROTOCOL; id: string; asset: MarketMonitorAsset; issuedAt: string
  policy: typeof JEV_DECISION_POLICY & { combinedProtocol: MarketJudgmentReport['protocol']; combinedDecisionPolicy: 'guarded-price-evidence-v2' }
  basis: { snapshotId: string; inputHash: string; capturedAt: string; strategyId: string; strategyVersion: number; provider: string | null }
  input: { state: Record<string, unknown>; questions: Record<string, JevQuestion>; history: Record<JevHorizon, ReturnHistory> }
  inputHash: string; rules: Record<JevHorizon, ReturnChoice | null>; combined: MarketJudgmentReport; recordHash: string
}
export interface ForwardCandidate {
  schemaVersion: 1; protocol: typeof FORWARD_PROTOCOL; publicationId: string; requestedAt: string; issuedAt: string; inputHash: string
  raw: JevResult; decisions: Record<JevHorizon, GuardedJevDecision>; recordHash: string
}
export interface ForwardRow {
  id: string; issuedAt: string; snapshotId: string; candidateAvailable: boolean; providerChanged: boolean
  outcomes: Array<{ horizon: JevHorizon; outcome: ReviewOutcome; actual: ReturnChoice | null
    choices: Record<ForwardMethod, ReturnChoice | null>; correct: Record<ForwardMethod, boolean | null>
    brier: { jev: number | null; frequency: number | null } }>
}
export interface ForwardSummary {
  horizon: JevHorizon; total: number; complete: number; pending: number; excluded: number; uniqueWindows: number; duplicateWindows: number
  methods: Record<ForwardMethod, { scored: number; correct: number; abstained: number }>
  probability: { count: number; jevBrier: number | null; frequencyBrier: number | null }
  matched: { count: number; correct: Record<ForwardMethod, number> }
}
export interface ForwardReport {
  protocol: typeof FORWARD_PROTOCOL; asset: MarketMonitorAsset; generatedAt: string; configured: boolean; automatic: boolean
  invalidRecords: number; historyTruncated: boolean; lastError: string | null; illustrative?: boolean
  latest: { publication: ForwardPublication; candidate: ForwardCandidate | null } | null
  rows: ForwardRow[]; summaries: ForwardSummary[]
}
