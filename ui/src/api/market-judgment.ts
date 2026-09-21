import type { MonitorAsset, TrendDirection } from './market-monitor'
import { fetchJson } from './client'
type TrendHorizon = 'short' | 'medium' | 'long'

// Browser DTO for the read-only current-evidence summary.
export type JudgmentDirection = 'bullish' | 'bearish' | 'range' | 'unclear' | 'insufficient'
export type JudgmentReason = 'rules-bullish' | 'rules-bearish' | 'range-observed' | 'rules-mixed' | 'daily-missing' | 'hourly-missing' | 'structure-conflict' | 'structure-pending' | 'structure-agrees' | 'structure-unknown' | 'context-partial' | 'earnings-near' | 'latest-scan-failed'
export interface MarketJudgmentReport {
  protocol: 'evidence-summary-v1'
  asset: MonitorAsset
  strategyId: string
  snapshotId: string
  generatedAt: string
  basis: { capturedAt: string; dailyAt: string | null; hourlyAt: string | null }
  quality: 'complete' | 'partial' | 'insufficient'
  horizons: Record<TrendHorizon, {
    sessions: number
    direction: JudgmentDirection
    rules: TrendDirection
    agreement: 'aligned' | 'mixed' | 'limited'
    reasons: JudgmentReason[]
    risks: JudgmentReason[]
  }>
  structure: { phase: string; direction: 'bullish' | 'bearish' | 'unclear'; confirmed: boolean; lower: number | null; upper: number | null; confirmation: string[]; invalidation: string[] }
  context: { currentFields: string[]; referenceFields: string[]; newsCount: number; filingsCount: number; earningsAt: string | null }
  jev: { status: 'current' | 'different-basis' | 'stale' | 'missing' | 'unavailable'; issuedAt: string | null; directions: Record<TrendHorizon, 'up' | 'flat' | 'down' | 'insufficient'> | null }
}

export const marketJudgmentApi = {
  read: (asset: MonitorAsset, signal?: AbortSignal) => fetchJson<MarketJudgmentReport>(`/api/market-monitor/judgment?asset=${asset}`, { signal, cache: 'no-store' }),
}
