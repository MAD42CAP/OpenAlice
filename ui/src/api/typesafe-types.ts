// Browser DTOs: keep aligned with the domain contract; no server runtime imports.
type JevQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> }
type JevAnswer = { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
import type { MonitorAsset as MarketMonitorAsset, TrendDirection } from './market-monitor'
import type { ReviewOutcome } from './market-review'

export const JEV_PROTOCOL = 'jev-forward-sessions-v1'
export const JEV_HORIZONS = ['short', 'medium', 'long'] as const
export type JevHorizon = typeof JEV_HORIZONS[number]
export interface JevForecast {
  schemaVersion: 1
  id: string
  asset: MarketMonitorAsset
  issuedAt: string
  model: string
  protocol: typeof JEV_PROTOCOL
  basis: { snapshotId: string; inputHash: string; capturedAt: string; strategyId: string; strategyVersion: number }
  inputHash: string
  recordHash: string
  state: Record<string, unknown>
  questions: Record<string, JevQuestion>
  horizons: Record<JevHorizon, { bars: number; answer: JevAnswer; adequacy: JevAnswer; baseline: TrendDirection }>
  inputTokens: number
  durationMs: number
}
export interface JevAudit {
  id: string; issuedAt: string; model: string; source: string; claim: string; sourceUrl: string | null
  answers: Record<string, JevAnswer>; inputTokens: number; durationMs: number
}
export interface JevReviewRow {
  forecast: JevForecast
  providerChanged: boolean
  outcomes: Array<{ horizon: JevHorizon; outcome: ReviewOutcome; actual: 'up' | 'flat' | 'down' | null; correct: boolean | null; brier: number | null }>
}
export interface JevReport {
  asset: MarketMonitorAsset; generatedAt: string; configured: boolean; automatic: boolean; model: string
  illustrative?: boolean
  historyTruncated: boolean
  invalidRecords: number
  lastError: string | null
  rows: JevReviewRow[]
  summaries: Array<{
    horizon: JevHorizon; total: number; complete: number; pending: number; excluded: number; abstained: number; scored: number
    uniqueWindows: number; duplicateWindows: number; correct: number; flatCalls: number; flatOutcomes: number
    accuracy: number | null; baselineAccuracy: number | null; baselineCompared: number; pairedAccuracy: number | null
    alwaysUpAccuracy: number | null; brier: number | null
    calibration: Array<{ from: number; to: number; count: number; meanProbability: number | null; observedAccuracy: number | null }>
  }>
}
