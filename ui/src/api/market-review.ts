import type { MonitorSnapshot, MonitorAsset, MarketAiNarration, TrendDirection } from './market-monitor'
import type { HistoricalBar } from './market'
type TrendHorizon = 'short' | 'medium' | 'long'

export type ReviewWindow = 7 | 30 | 90
export type ReviewHorizon = 'day' | 'week' | 'month'
export type ReviewStatus = 'complete' | 'pending' | 'missing-data' | 'unverified'
export type ReviewVerdict = 'supported' | 'opposed' | 'flat' | 'not-scored'
export interface ReviewOutcome {
  horizon: ReviewHorizon
  trendHorizon: TrendHorizon
  targetBars: number
  observedBars: number
  status: ReviewStatus
  direction: TrendDirection
  verdict: ReviewVerdict
  start: string | null
  end: string | null
  entry: number | null
  close: number | null
  changePercent: number | null
  highPercent: number | null
  lowPercent: number | null
  range: { above: number; below: number; inside: number } | null
}
export type ReviewOriginal = Pick<MonitorSnapshot, 'capturedAt' | 'metrics' | 'hypothesis' | 'trend' | 'wyckoff' | 'dailyBrief' | 'evidence' | 'sourceHealth'>
export type ReviewNarration = Pick<MarketAiNarration, 'generatedAt' | 'headline' | 'summary' | 'shortTerm' | 'mediumTerm' | 'longTerm' | 'evidence' | 'risks' | 'watchFor'>
export interface ReviewCase {
  id: string
  kind: 'rules' | 'narration'
  snapshotId: string | null
  issuedAt: string
  sessionDate: string
  strategyVersion: number | null
  archiveStatus: 'verified' | 'unavailable' | 'invalid'
  original: ReviewOriginal | null
  narration: ReviewNarration | null
  originalProvider: string | null
  outcomeProvider: string | null
  providerChanged: boolean
  path: Array<Pick<HistoricalBar, 'date' | 'open' | 'high' | 'low' | 'close'>>
  outcomes: ReviewOutcome[]
}
export interface ReviewSummary {
  strategyVersion: number | null
  horizon: ReviewHorizon
  total: number
  complete: number
  pending: number
  excluded: number
  supported: number
  opposed: number
  flat: number
  nonDirectional: number
  scored: number
  agreementPercent: number | null
  alwaysBullishPercent: number | null
  /** Descriptive overlapping observations, never independent trading trials. */
  cases: string[]
}
export type ReviewLessonCode = 'collect-more' | 'direction-misses' | 'path-risk' | 'mixed-trends' | 'narrative-review' | 'archive-gap' | 'feed-change'
export interface ReviewLesson { code: ReviewLessonCode; count: number; caseIds: string[] }
export interface MarketReviewReport {
  illustrative?: boolean
  schemaVersion: 1
  policy: 'forward-sessions-v1'
  asset: MonitorAsset
  strategyId: string
  generatedAt: string
  windowDays: ReviewWindow
  from: string
  oldestObservationAt: string | null
  historyTruncated: boolean
  flatThresholdPercent: 0.25
  rows: ReviewCase[]
  summaries: ReviewSummary[]
  lessons: ReviewLesson[]
}
