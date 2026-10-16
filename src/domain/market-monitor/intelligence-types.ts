import type { MarketMonitorAsset } from './types.js'

/** Shared attribution across market observations, published research and AI inference. */
export interface EvidenceReference {
  id: string
  asset: MarketMonitorAsset
  sourceName: string
  sourceUrl: string | null
  metric: string
  value: number | string | null
  unit: string | null
  dataAsOf: string | null
  publishedAt: string | null
  retrievedAt: string
  quality: 'available' | 'unknown' | 'unavailable' | 'outdated'
  reportId: string | null
  kind: 'observation' | 'interpretation' | 'inference'
  excerpt?: string
}

export interface IntelligenceClaim {
  text: string
  evidenceIds: string[]
  /** Explicitly distinguishes the platform's inference from a source assertion. */
  inference: boolean
}

export interface IntelligenceProvenance {
  workspaceId: string
  runId: string
  issueId: string
  agent: string
  model?: string
}

export const INTELLIGENCE_ISSUE_ID = 'mad42lab-investment-intelligence'
export const intelligenceIssueId = (asset: MarketMonitorAsset) => asset === 'BTC' ? INTELLIGENCE_ISSUE_ID : `mad42lab-${asset.toLowerCase()}-investment-intelligence`
