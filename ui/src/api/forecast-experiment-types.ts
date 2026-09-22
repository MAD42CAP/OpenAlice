// Browser DTO; no server runtime imports.
type JevQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> }
type JevAnswer = { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
type JevResult = { model: string; answers: Record<string, JevAnswer>; inputTokens: number; durationMs: number }
import type { JevForecast, JevHorizon } from './typesafe-types'
import type { MarketJudgmentReport } from './market-judgment'
import type { ReviewOutcome } from './market-review'
import type { MonitorAsset as MarketMonitorAsset } from './market-monitor'

export const EXPERIMENT_PROTOCOL = 'same-evidence-history-v1'
export type ReturnChoice = 'up' | 'flat' | 'down'
export type ExperimentMethod = 'original' | 'challenger' | 'rules' | 'combined' | 'frequency' | 'alwaysUp'
export interface ReturnHistory {
  sessions: number; samples: number; firstEntryAt: string | null; lastExitAt: string | null
  meanPercent: number | null; volatilityPercent: number | null; medianAbsolutePercent: number | null
  probabilities: Record<ReturnChoice, number> | null
}
export interface ExperimentPublication {
  protocol: typeof EXPERIMENT_PROTOCOL; id: string; asset: MarketMonitorAsset; issuedAt: string; recordHash: string
  original: JevForecast; combined: MarketJudgmentReport
}
export interface ExperimentCandidate {
  protocol: typeof EXPERIMENT_PROTOCOL; publicationId: string; issuedAt: string; recordHash: string; inputHash: string
  state: Record<string, unknown>; questions: Record<string, JevQuestion>; result: JevResult
  history: Record<JevHorizon, ReturnHistory>
}
export interface ExperimentRow {
  id: string; issuedAt: string; snapshotId: string; providerChanged: boolean; candidateAvailable: boolean
  outcomes: Array<{ horizon: JevHorizon; outcome: ReviewOutcome; actual: ReturnChoice | null
    choices: Record<ExperimentMethod, ReturnChoice | null>; correct: Record<ExperimentMethod, boolean | null>
    brier: Record<'original' | 'challenger' | 'frequency', number | null> }>
}
export interface ExperimentReport {
  protocol: typeof EXPERIMENT_PROTOCOL; asset: MarketMonitorAsset; generatedAt: string; configured: boolean; automatic: boolean
  invalidRecords: number; historyTruncated: boolean; lastError: string | null; illustrative?: boolean
  latest: { publication: ExperimentPublication; candidate: ExperimentCandidate | null } | null
  rows: ExperimentRow[]
  summaries: Array<{ horizon: JevHorizon; total: number; complete: number; pending: number; excluded: number; uniqueWindows: number; duplicateWindows: number
    methods: Record<ExperimentMethod, { scored: number; correct: number }>
    paired: { count: number; originalCorrect: number; challengerCorrect: number; originalBrier: number | null; challengerBrier: number | null; frequencyBrier: number | null } }>
}
export type AtomicAnswers = Record<'breakout' | 'hold' | 'participation', JevAnswer>
