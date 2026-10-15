// Browser projection of the BTC research feedback contract.
import type { EvidenceReference, IntelligenceProvenance } from './market-intelligence-types'
export const RESEARCH_LOOP_PROTOCOL = 'btc-research-loop-v1' as const
export type ResearchRole = 'prediction' | 'quant'
export type ResearchSource = ResearchRole | 'jev'
export interface ResearchFeedbackRecord {
  schemaVersion: 1; protocol: typeof RESEARCH_LOOP_PROTOCOL; id: string; asset: 'BTC'; role: ResearchRole
  inputId: string; inputHash: string; issuedAt: string; expiresAt: string
  basis: { snapshotId: string; marketDataAsOf: string | null; capturedAt: string }
  provenance: IntelligenceProvenance; validation: 'unvalidated'; evidence: EvidenceReference[]; recordHash: string
  summary: string; horizon: 'short' | 'medium' | 'long' | 'all'; conclusion: 'supports' | 'opposes' | 'inconclusive'
  supportingEvidenceIds: string[]; opposingEvidenceIds: string[]; confirmation: string; invalidation: string
  limitations: string[]; recommendations: string[]
}
export interface ResearchLoopContext {
  protocol: typeof RESEARCH_LOOP_PROTOCOL; hash: string; asOf: string
  records: ResearchFeedbackRecord[]
  jev: { publicationId: string; candidateHash: string; issuedAt: string; inputHash: string; snapshotId: string; decisions: Record<'short' | 'medium' | 'long', { choice: 'up' | 'flat' | 'down' | null; reasons: string[] }> } | null
  evidence: EvidenceReference[]
}
export interface ResearchContributor {
  source: ResearchSource; state: 'ready' | 'waiting' | 'running' | 'failed' | 'blocked' | 'stale'
  updatedAt: string | null; summary: string; recordId: string | null; workspaceId: string | null; runId: string | null
}
export interface ResearchFeedbackReceipt {
  protocol: typeof RESEARCH_LOOP_PROTOCOL; contextHash: string; reviewedIds: string[]
  effect: 'context-only' | 'caution' | 'conflict'; explanation: string
}
export interface ResearchLoopReport {
  protocol: typeof RESEARCH_LOOP_PROTOCOL; asset: 'BTC'; generatedAt: string; contributors: ResearchContributor[]
  context: ResearchLoopContext; history: ResearchFeedbackRecord[]; invalidRecords: number; illustrative?: boolean
  synthesis: { contextHash: string; snapshotId: string; analysisTime: string } | null
}
