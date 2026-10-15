import type { EvidenceReference } from './intelligence-types.js'

export const RESEARCH_ANALYSIS_VERSION = 'glassnode-research-v1' as const
export const RESEARCH_SECTION_KEYS = ['coreConclusion', 'onchainMetrics', 'holderBehavior', 'capitalFlows', 'costStructure', 'marketCycle', 'keyPriceAreas', 'scenarios', 'limitations', 'independentView'] as const
export type ResearchSectionKey = typeof RESEARCH_SECTION_KEYS[number]

/** Public metadata. The licensed source text is deliberately stored separately. */
export interface ResearchReport {
  schemaVersion: 1
  id: string
  asset: 'BTC'
  sourceName: 'Glassnode'
  url: string
  title: string
  publishedAt: string | null
  retrievedAt: string
  reportPeriod: string | null
  contentHash: string
  paragraphCount: number
  preview: string
  origin: 'url' | 'manual'
}

/** Exposed only to the authorized native research run, never a public route. */
export interface ResearchSource {
  reportId: string
  contentHash: string
  paragraphs: EvidenceReference[]
}

export interface ResearchClaim {
  text: string
  evidenceIds: string[]
  /** Unsupported claims must explicitly identify themselves as inference. */
  inference: boolean
}

export interface ResearchMetric {
  name: string
  value: number | string | null
  unit: string | null
  dataAsOf: string | null
  kind: 'observation' | 'interpretation' | 'inference'
  evidenceIds: string[]
  meaning: ResearchClaim
  change: ResearchClaim | null
}

export interface ResearchPriceLevel {
  label: string
  price: number
  unit: 'USD'
  role: 'support' | 'resistance' | 'cost-basis' | 'reference'
  dataAsOf: string | null
  evidenceIds: string[]
}

export interface ResearchWeeklyChange {
  topic: string
  text: string
  currentEvidenceIds: string[]
  previousEvidenceIds: string[]
  inference: boolean
}

export interface ResearchDraft {
  dataAsOf: string | null
  mainThesis: ResearchClaim
  sections: Record<ResearchSectionKey, ResearchClaim[]>
  metrics: ResearchMetric[]
  keyPriceLevels: ResearchPriceLevel[]
  bullishEvidence: ResearchClaim[]
  bearishEvidence: ResearchClaim[]
  uncertainties: ResearchClaim[]
  limitations: ResearchClaim[]
  weeklyChanges: ResearchWeeklyChange[]
}

export interface ResearchProvenance {
  workspaceId: string
  runId: string
  issueId: string
  agent: string
  model?: string
  effort?: string
}

export interface ResearchSnapshot extends ResearchDraft {
  schemaVersion: 1
  id: string
  asset: 'BTC'
  reportId: string
  reportUrl: string
  reportTitle: string
  publicationTime: string | null
  reportPeriod: string | null
  reportHash: string
  previousSnapshotId: string | null
  analysisVersion: typeof RESEARCH_ANALYSIS_VERSION
  analysisTime: string
  analysisModel: string | null
  revision: number
  provenance: ResearchProvenance
  /** Verified source paragraphs referenced by the analysis, with short excerpts. */
  evidence: EvidenceReference[]
  recordHash: string
}

export interface ResearchStatus {
  state: 'never-checked' | 'current' | 'checking' | 'failed'
  lastCheckedAt: string | null
  nextCheckAt: string | null
  lastError: string | null
  latestReportId: string | null
  pendingReportIds: string[]
}

export interface ResearchDiscoveryResult {
  checked: boolean
  imported: boolean
  report: ResearchReport | null
  status: ResearchStatus
}

export interface ResearchImportResult { stored: boolean; report: ResearchReport }
