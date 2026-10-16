// Browser projection of per-asset research feedback.
import type { MonitorAsset } from './market-monitor'
import type { EvidenceReference, IntelligenceProvenance } from './market-intelligence-types'
export const RESEARCH_LOOP_PROTOCOL = 'btc-research-loop-v1' as const
export type ResearchLoopProtocol = typeof RESEARCH_LOOP_PROTOCOL | 'equity-research-loop-v1'
export const researchLoopProtocol = (asset: MonitorAsset): ResearchLoopProtocol => asset === 'BTC' ? RESEARCH_LOOP_PROTOCOL : 'equity-research-loop-v1'
export type ResearchRole = 'prediction' | 'quant'
export type ResearchSource = ResearchRole | 'jev'
export interface ResearchFeedbackRecord {
  schemaVersion: 1; protocol: ResearchLoopProtocol; id: string; asset: MonitorAsset; role: ResearchRole
  inputId: string; inputHash: string; issuedAt: string; expiresAt: string
  basis: { snapshotId: string; marketDataAsOf: string | null; capturedAt: string }
  provenance: IntelligenceProvenance; validation: 'unvalidated'; evidence: EvidenceReference[]; recordHash: string
  summary: string; horizon: 'short' | 'medium' | 'long' | 'all'; conclusion: 'supports' | 'opposes' | 'inconclusive'
  supportingEvidenceIds: string[]; opposingEvidenceIds: string[]; confirmation: string; invalidation: string
  limitations: string[]; recommendations: string[]
}
export interface ResearchLoopContext {
  protocol: ResearchLoopProtocol; asset?: MonitorAsset; hash: string; asOf: string
  records: ResearchFeedbackRecord[]
  jev: { publicationId: string; candidateHash: string; issuedAt: string; inputHash: string; snapshotId: string; decisions: Record<'short' | 'medium' | 'long', { choice: 'up' | 'flat' | 'down' | null; reasons: string[] }> } | null
  evidence: EvidenceReference[]
}
export interface ResearchContributor {
  source: ResearchSource; state: 'ready' | 'waiting' | 'running' | 'failed' | 'blocked' | 'stale'
  updatedAt: string | null; summary: string; recordId: string | null; workspaceId: string | null; runId: string | null
}
export interface ResearchFeedbackReceipt {
  protocol: ResearchLoopProtocol; contextHash: string; reviewedIds: string[]
  effect: 'context-only' | 'caution' | 'conflict'; explanation: string
}
export interface ResearchLoopReport {
  protocol: ResearchLoopProtocol; asset: MonitorAsset; generatedAt: string; contributors: ResearchContributor[]
  context: ResearchLoopContext; history: ResearchFeedbackRecord[]; invalidRecords: number; illustrative?: boolean
  synthesis: { contextHash: string; snapshotId: string; analysisTime: string } | null
}
