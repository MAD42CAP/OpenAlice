import type { InvestmentAnalysisVersion, InvestmentInput, InvestmentSnapshot } from './investment-types.js'
import type { MarketMonitorAsset, TrendHorizon } from './types.js'
import type { ReviewStatus } from './review.js'

export const NATIVE_FORWARD_PROTOCOL = 'native-investment-forward-v1' as const
export interface NativeForwardBinding { protocol: typeof NATIVE_FORWARD_PROTOCOL; originInputHash: string }
/** The exact guarded publication and original native input, never regenerated prose. */
export interface NativeForwardPublication {
  schemaVersion: 1; protocol: typeof NATIVE_FORWARD_PROTOCOL; id: string; asset: MarketMonitorAsset
  issuedAt: string; sessionDate: string; originInputHash: string; input: InvestmentInput; snapshot: InvestmentSnapshot
  basis: { snapshotId: string; inputHash: string; strategyId: string; strategyVersion: number; provider: string | null; receiptId: string; completedAt: string }
  recordHash: string
}
/** Written only after the matching source publication has actually committed. */
export interface NativeForwardCommit {
  schemaVersion: 1; protocol: typeof NATIVE_FORWARD_PROTOCOL; id: string; asset: MarketMonitorAsset
  publishedAt: string; captureHash: string; snapshotHash: string; recordHash: string
}
export interface NativeForwardOutcome {
  horizon: TrendHorizon; sessions: number; status: ReviewStatus
  start: string | null; end: string | null; entry: number | null; close: number | null; changePercent: number | null
  actual: 'up' | 'flat' | 'down' | null; intent: 'up' | 'down' | null
  intentKind: 'unconditional' | 'conditional' | 'abstain'; correct: boolean | null
  conditions: { defined: boolean; confirmationAt: string | null; invalidationAt: string | null }
}
export interface NativeForwardRow {
  publicationId: string; issuedAt: string; analysisVersion: InvestmentAnalysisVersion
  basis: Omit<NativeForwardPublication['basis'], 'receiptId' | 'completedAt'> & Partial<Pick<NativeForwardPublication['basis'], 'receiptId' | 'completedAt'>>
  outcomeSnapshotId: string | null; outcomeProvider: string | null; providerChanged: boolean
  outcomes: NativeForwardOutcome[]
}
export interface NativeForwardSummary {
  horizon: TrendHorizon; sessions: number; total: number; pending: number; excluded: number
  uniqueWindows: number; suppressedWindows: number
  unconditional: { scored: number; correct: number }; conditionalIntent: { scored: number; correct: number }
  abstained: number
  conditions: { defined: number; confirmationTriggered: number; invalidationTriggered: number; bothTriggered: number }
}
export interface NativeForwardReport {
  protocol: typeof NATIVE_FORWARD_PROTOCOL; asset: MarketMonitorAsset; generatedAt: string; asOf: string | null
  historyTruncated: boolean; rowsTruncated: boolean; invalidRecords: number; orphanedRecords: number
  readError?: boolean; readErrorReason?: 'registration-read-failed' | 'market-history-read-failed'
  outcomeReceiptUnavailable?: number
  excludedSessions: string[]; rows: NativeForwardRow[]
  current: NativeForwardReport['cohorts'][number] | null
  cohorts: Array<{ analysisVersion: InvestmentAnalysisVersion; strategyId: string; strategyVersion: number; summaries: NativeForwardSummary[] }>
  note: string
}
