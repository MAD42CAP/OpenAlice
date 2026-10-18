// Browser mirror of the three-layer research contracts. No source report text is exposed.
import type { HistoricalBar } from './market'
import type { MonitorAsset, TrendDirection } from './market-monitor'
import type { ResearchFeedbackReceipt, ResearchLoopContext } from './research-loop-types'
import type { NativeForwardBinding, NativeForwardReport } from './native-forward-types'
type OhlcvBar = HistoricalBar
export type TrendHorizon = 'short' | 'medium' | 'long'
/** Shared attribution across market observations, published research and AI inference. */
export interface EvidenceReference {
  id: string
  asset: MonitorAsset
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


export const RESEARCH_ANALYSIS_VERSION = 'glassnode-research-v1' as const
export const RESEARCH_SECTION_KEYS = ['coreConclusion', 'onchainMetrics', 'holderBehavior', 'capitalFlows', 'costStructure', 'marketCycle', 'keyPriceAreas', 'scenarios', 'limitations', 'independentView'] as const
export type ResearchSectionKey = typeof RESEARCH_SECTION_KEYS[number]

/** Public metadata. The licensed source text is deliberately stored separately. */
export interface ResearchReport {
  schemaVersion: 1
  id: string
  asset: MonitorAsset
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

export const INVESTMENT_ANALYSIS_VERSION = 'investment-intelligence-v4' as const
export type InvestmentAnalysisVersion = 'investment-intelligence-v1' | 'investment-intelligence-v2' | 'investment-intelligence-v3' | typeof INVESTMENT_ANALYSIS_VERSION | 'investment-intelligence-equity-v1' | 'investment-intelligence-equity-v2'
export type ValidationStatus = 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'CONFLICTING' | 'UNVERIFIED' | 'OUTDATED'
export type InvestmentDirection = 'bullish' | 'neutral' | 'bearish' | 'conditional-bullish' | 'conditional-bearish' | 'uncertain'
export interface MarketIntelligence {
  schemaVersion: 1; id: string; asset: MonitorAsset; snapshotId: string; analysisTime: string; retrievedAt: string
  marketDataAsOf: string | null; hourlyDataAsOf: string | null; price: number | null; volume: number | null
  priceKind: 'completed-daily-close'; daily: OhlcvBar[]; hourly: OhlcvBar[]
  horizons: Array<{ horizon: TrendHorizon; observationWindow: string; direction: TrendDirection; structure: string; supportLevels: number[]; resistanceLevels: number[]; momentum: IntelligenceClaim; risks: string[]; confirmation: string[]; invalidation: string[]; evidenceIds: string[] }>
  wyckoffHypothesis: { phase: string; confirmed: false; supportingEvidence: string[]; opposingEvidence: string[]; confirmation: string[]; invalidation: string[] } | null
  bullishEvidence: IntelligenceClaim[]; bearishEvidence: IntelligenceClaim[]; evidence: EvidenceReference[]
  dataSources: Array<{ name: string; status: string; dataAsOf: string | null; retrievedAt: string }>
  dataQuality: 'complete' | 'partial' | 'unavailable'; missingData: string[]; limitations: string[]
}
export interface InvestmentInput { market: MarketIntelligence; research: ResearchSnapshot | null; researchFeedback?: ResearchLoopContext }
export interface InvestmentCrossValidation {
  claim: IntelligenceClaim; marketEvidenceIds: string[]; researchEvidenceIds: string[]
  status: ValidationStatus; explanation: string; horizon?: TrendHorizon
}
export interface InvestmentPriceLevel { label: string; price: number; unit: 'USD'; role: 'support' | 'resistance' | 'cost-basis' | 'reference'; evidenceIds: string[] }
export interface InvestmentOutlook {
  horizon: TrendHorizon; direction: InvestmentDirection; conclusion: IntelligenceClaim; structure: IntelligenceClaim
  supportingEvidence: IntelligenceClaim[]; opposingEvidence: IntelligenceClaim[]; risks: IntelligenceClaim[]
  confirmation: IntelligenceClaim[]; invalidation: IntelligenceClaim[]; priceLevelLabels: string[]
  decisionConditions?: { confirmation: InvestmentCondition; invalidation: InvestmentCondition }
}
export interface InvestmentScenario {
  kind: 'bullish' | 'neutral' | 'bearish'; hypothesis: IntelligenceClaim; conditions: IntelligenceClaim[]; confirmation: IntelligenceClaim[]
  path: IntelligenceClaim; invalidation: IntelligenceClaim[]; supportingEvidence: IntelligenceClaim[]; opposingEvidence: IntelligenceClaim[]; priceLevelLabels: string[]
}
export type InvestmentConditionMetric = 'daily-close' | 'daily-change-percent' | 'volume-ratio'
export interface InvestmentCondition { metric: InvestmentConditionMetric; operator: 'gt' | 'gte' | 'lt' | 'lte'; threshold: number; thresholdEvidenceId: string | null; description: string }
export interface InvestmentThesisDraft {
  key: string; title: string; claim: IntelligenceClaim; horizon: TrendHorizon; observationDays: number
  supportConditions: InvestmentCondition[]; invalidationConditions: InvestmentCondition[]; resolutionConditions: InvestmentCondition[]
}
export interface InvestmentDraft {
  summary: IntelligenceClaim; crossValidation: InvestmentCrossValidation[]; outlooks: InvestmentOutlook[]; scenarios: InvestmentScenario[]
  priceMap: InvestmentPriceLevel[]; theses: InvestmentThesisDraft[]; limitations: IntelligenceClaim[]
  feedbackReview?: Pick<ResearchFeedbackReceipt, 'reviewedIds' | 'effect' | 'explanation'>
}
export interface InvestmentSnapshot extends InvestmentDraft {
  schemaVersion: 1; id: string; asset: MonitorAsset; analysisVersion: InvestmentAnalysisVersion; analysisTime: string
  marketSnapshotId: string; researchSnapshotId: string | null; inputHash: string; previousSnapshotId: string | null
  provenance: IntelligenceProvenance; analysisModel: string | null; evidence: EvidenceReference[]
  rawDraft: InvestmentDraft; guardWarnings: string[]; changes: Array<{ horizon: TrendHorizon; previous: InvestmentDirection; current: InvestmentDirection; evidenceIds: string[]; explanation: string }>; recordHash: string
  researchFeedback?: ResearchFeedbackReceipt
  forwardValidation?: NativeForwardBinding
}
export type InvestmentThesisStatus = 'ACTIVE' | 'STRENGTHENING' | 'WEAKENING' | 'CHALLENGED' | 'INVALIDATED' | 'RESOLVED' | 'EXPIRED'
export interface InvestmentThesis extends InvestmentThesisDraft {
  id: string; revision: 1; createdAt: string; expiresAt: string; investmentSnapshotId: string; evidence: EvidenceReference[]; recordHash: string
}
export interface InvestmentThesisEvaluation {
  id: string; thesisId: string; thesisRevision: 1; evaluatedAt: string; marketSnapshotId: string; previousStatus: InvestmentThesisStatus; status: InvestmentThesisStatus
  reason: string; rows: Array<{ kind: 'support' | 'invalidate' | 'resolve'; condition: InvestmentCondition; value: number | null; result: 'met' | 'not-met' | 'unknown'; evidence: EvidenceReference | null }>
  evidence: EvidenceReference[]; recordHash: string
}
export interface InvestmentReport {
  schemaVersion: 1; generatedAt: string; asOf: string | null; latest: InvestmentSnapshot | null; history: InvestmentSnapshot[]
  theses: Array<InvestmentThesis & { status: InvestmentThesisStatus; latestEvaluation: InvestmentThesisEvaluation | null }>; evaluations: InvestmentThesisEvaluation[]
  quality: { total: number; active: number; resolved: number; invalidated: number; expired: number; unresolved: number; conditionDefined: number; stateChanges: number; meanDurationDays: number | null; directionalAccuracy: null; note: string }
  nativeForward?: NativeForwardReport
}
