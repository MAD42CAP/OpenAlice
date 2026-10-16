import type { EvidenceReference, IntelligenceProvenance } from './intelligence-types.js'
import type { MarketIntelligence } from './investment-types.js'
import type { ResearchSnapshot } from './research-types.js'
import type { ForwardReport } from './forecast-validation-types.js'
import type { MarketMonitorAsset } from './types.js'

export const RESEARCH_LOOP_PROTOCOL = 'btc-research-loop-v1' as const
export const RESEARCH_LOOP_ISSUES = { prediction: 'mad42lab-btc-prediction-research', quant: 'mad42lab-btc-quant-review' } as const
export const EQUITY_RESEARCH_LOOP_PROTOCOL = 'equity-research-loop-v1' as const
export type ResearchLoopProtocol = typeof RESEARCH_LOOP_PROTOCOL | typeof EQUITY_RESEARCH_LOOP_PROTOCOL
export const researchLoopProtocol = (asset: MarketMonitorAsset): ResearchLoopProtocol => asset === 'BTC' ? RESEARCH_LOOP_PROTOCOL : EQUITY_RESEARCH_LOOP_PROTOCOL
export const researchLoopIssueIds = (asset: MarketMonitorAsset): Record<ResearchRole, string> => asset === 'BTC' ? RESEARCH_LOOP_ISSUES : { prediction: `mad42lab-${asset.toLowerCase()}-prediction-research`, quant: `mad42lab-${asset.toLowerCase()}-quant-review` }
export type ResearchRole = keyof typeof RESEARCH_LOOP_ISSUES
export type ResearchSource = ResearchRole | 'jev'
export interface ResearchLoopJob {
  state: 'idle' | 'queued' | 'running' | 'success' | 'failed' | 'blocked'
  message: string; updatedAt: string | null; workspaceId: string | null; runId: string | null
}
export interface ResearchLoopRunner {
  ensure(): Promise<void>
  status(role: ResearchRole): Promise<ResearchLoopJob>
  run(role: ResearchRole): Promise<ResearchLoopJob>
}
export interface ResearchFeedbackDraft {
  summary: string
  horizon: 'short' | 'medium' | 'long' | 'all'
  conclusion: 'supports' | 'opposes' | 'inconclusive'
  supportingEvidenceIds: string[]; opposingEvidenceIds: string[]
  confirmation: string; invalidation: string
  limitations: string[]; recommendations: string[]
}
export interface ResearchFeedbackRecord extends ResearchFeedbackDraft {
  schemaVersion: 1; protocol: ResearchLoopProtocol; id: string; asset: MarketMonitorAsset; role: ResearchRole
  inputId: string; inputHash: string; issuedAt: string; expiresAt: string
  basis: { snapshotId: string; marketDataAsOf: string | null; capturedAt: string }
  provenance: IntelligenceProvenance; validation: 'unvalidated'; evidence: EvidenceReference[]; recordHash: string
}
export interface ResearchLoopJev {
  publicationId: string; candidateHash: string; issuedAt: string; inputHash: string; snapshotId: string
  decisions: Record<'short' | 'medium' | 'long', { choice: 'up' | 'flat' | 'down' | null; reasons: string[] }>
}
export interface ResearchLoopContext {
  protocol: ResearchLoopProtocol; hash: string; asOf: string
  /** BTC legacy contexts omit this field to preserve their published identities. */
  asset?: MarketMonitorAsset
  records: ResearchFeedbackRecord[]; jev: ResearchLoopJev | null; evidence: EvidenceReference[]
}
export interface ResearchLoopInput {
  schemaVersion: 1; protocol: ResearchLoopProtocol; id: string; hash: string; capturedAt: string; expiresAt: string
  role: ResearchRole; provenance: IntelligenceProvenance
  market: MarketIntelligence; research: ResearchSnapshot | null; forward: ForwardReport
  previous: ResearchFeedbackRecord[]; evidence: EvidenceReference[]
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
  protocol: ResearchLoopProtocol; asset: MarketMonitorAsset; generatedAt: string; contributors: ResearchContributor[]
  context: ResearchLoopContext; history: ResearchFeedbackRecord[]; invalidRecords: number; illustrative?: boolean
  synthesis: { contextHash: string; snapshotId: string; analysisTime: string } | null
}
