import type { EvidenceReference, IntelligenceClaim, IntelligenceProvenance } from './intelligence-types.js'
import type { ResearchSnapshot } from './research-types.js'
import type { MarketMonitorAsset, TrendDirection, TrendHorizon } from './types.js'
import type { OhlcvBar } from '../market-data/bars/types.js'
import type { ResearchFeedbackReceipt, ResearchLoopContext } from './research-loop-types.js'

export const INVESTMENT_ANALYSIS_VERSION = 'investment-intelligence-v4' as const
export const EQUITY_INVESTMENT_ANALYSIS_VERSION = 'investment-intelligence-equity-v2' as const
export const investmentAnalysisVersion = (asset: MarketMonitorAsset) => asset === 'BTC' ? INVESTMENT_ANALYSIS_VERSION : EQUITY_INVESTMENT_ANALYSIS_VERSION
/** Archived v1 records retain their original bytes, hashes and evaluation protocol. */
export type InvestmentAnalysisVersion = 'investment-intelligence-v1' | 'investment-intelligence-v2' | 'investment-intelligence-v3' | 'investment-intelligence-equity-v1' | typeof INVESTMENT_ANALYSIS_VERSION | typeof EQUITY_INVESTMENT_ANALYSIS_VERSION
export type ValidationStatus = 'CONFIRMED' | 'PARTIALLY_CONFIRMED' | 'CONFLICTING' | 'UNVERIFIED' | 'OUTDATED'
export type InvestmentDirection = 'bullish' | 'neutral' | 'bearish' | 'conditional-bullish' | 'conditional-bearish' | 'uncertain'
export interface MarketIntelligence {
  schemaVersion: 1; id: string; asset: MarketMonitorAsset; snapshotId: string; analysisTime: string; retrievedAt: string
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
  /** The research question's horizon; a matching server-projected trend reference is still required. */
  horizon?: TrendHorizon
  claim: IntelligenceClaim; marketEvidenceIds: string[]; researchEvidenceIds: string[]
  status: ValidationStatus; explanation: string
}
export interface InvestmentPriceLevel { label: string; price: number; unit: 'USD'; role: 'support' | 'resistance' | 'cost-basis' | 'reference'; evidenceIds: string[] }
export interface InvestmentOutlook {
  horizon: TrendHorizon; direction: InvestmentDirection; conclusion: IntelligenceClaim; structure: IntelligenceClaim
  supportingEvidence: IntelligenceClaim[]; opposingEvidence: IntelligenceClaim[]; risks: IntelligenceClaim[]
  confirmation: IntelligenceClaim[]; invalidation: IntelligenceClaim[]; priceLevelLabels: string[]
  /** Publication-bound price conditions; never a rewrite of a stable-key thesis. */
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
  schemaVersion: 1; id: string; asset: MarketMonitorAsset; analysisVersion: InvestmentAnalysisVersion; analysisTime: string
  marketSnapshotId: string; researchSnapshotId: string | null; inputHash: string; previousSnapshotId: string | null
  provenance: IntelligenceProvenance; analysisModel: string | null; evidence: EvidenceReference[]
  rawDraft: InvestmentDraft; guardWarnings: string[]; changes: Array<{ horizon: TrendHorizon; previous: InvestmentDirection; current: InvestmentDirection; evidenceIds: string[]; explanation: string }>; recordHash: string
  researchFeedback?: ResearchFeedbackReceipt
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
}
