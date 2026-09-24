import type { MarketMonitorAsset } from './types.js'

export const THESIS_METRICS = ['daily-close', 'daily-change', 'volume-ratio', 'funding-8h', 'annualized-basis', 'put-call-ratio', 'strategy-mnav', 'manual'] as const
export type ThesisMetric = typeof THESIS_METRICS[number]
export interface ThesisCondition {
  id: string
  label: string
  kind: 'support' | 'invalidate'
  metric: ThesisMetric
  operator: 'gt' | 'gte' | 'lt' | 'lte'
  threshold: number | null
}
export interface ThesisDraft {
  thesis: string
  horizon: string
  enabled: boolean
  changeNote: string
  conditions: ThesisCondition[]
}
export interface ThesisRevision extends ThesisDraft {
  schemaVersion: 1
  asset: MarketMonitorAsset
  revision: number
  createdAt: string
  recordHash: string
}
export type ThesisReason = 'available' | 'manual' | 'missing' | 'stale' | 'source-unavailable' | 'formula-changed' | 'invalid-time'
export interface ThesisEvidence {
  metric: ThesisMetric
  value: number | null
  unit: 'usd' | 'percent' | 'ratio' | 'text'
  provider: string | null
  dataAt: string | null
  observedAt: string | null
  expiresAt: string | null
  formulaVersion: string
  reason: ThesisReason
}
export interface ThesisCheck {
  schemaVersion: 1
  asset: MarketMonitorAsset
  revision: ThesisRevision
  checkedAt: string
  evidence: ThesisEvidence[]
  /** Frozen original result; future evaluator changes cannot rewrite history. */
  evaluation: ThesisEvaluation
  dedupKey: string
  recordHash: string
}
export interface ThesisEvaluation {
  status: 'paused' | 'triggered' | 'incomplete' | 'supported' | 'watch'
  supported: number
  triggered: number
  unknown: number
  rows: Array<{ condition: ThesisCondition; evidence: ThesisEvidence; result: 'met' | 'not-met' | 'unknown' }>
}
export interface ThesisReport {
  asset: MarketMonitorAsset
  generatedAt: string
  revision: ThesisRevision | null
  current: ThesisEvaluation | null
  lastCheckedAt: string | null
  checkError: boolean
  revisions: ThesisRevision[]
  checks: ThesisCheck[]
  truncated: boolean
}
export const thesisMetricAllowed = (asset: MarketMonitorAsset, metric: ThesisMetric) =>
  ['daily-close', 'daily-change', 'volume-ratio', 'manual'].includes(metric)
  || asset === 'BTC' && ['funding-8h', 'annualized-basis', 'put-call-ratio'].includes(metric)
  || asset === 'MSTR' && metric === 'strategy-mnav'
