import { fetchJson, headers } from './client'
import type { BarMeta, HistoricalBar } from './market'

export type MonitorAsset = 'BTC' | 'TSLA'
export type MonitorTrigger = 'manual' | 'scheduled'

export interface MonitorSettings {
  backgroundEnabled: boolean
  enabledAssets: MonitorAsset[]
  strategyId: string
  intervalMinutes: number
  notifications: boolean
  alertConfidence: number
  abnormalVolumeRatio: number
  abnormalMovePercent: number
}

export interface MonitorStrategy {
  id: string
  label: string
  version: number
  description: string
  requiredData: Array<'daily-bars' | 'hourly-bars' | 'asset-context'>
}

export interface MonitorContextProvider {
  id: string
  label: string
  assets: MonitorAsset[]
  description: string
}

export interface SourceHealth {
  id: string
  label: string
  status: 'ok' | 'degraded' | 'unavailable'
  provider: string
  asOf: string | null
  detail: string
}

export interface EvidenceItem {
  id: string
  label: string
  timeframe: '1D' | '1W' | '1H'
  tone: 'positive' | 'negative' | 'neutral'
  observation: string
  interpretation: string
  weight: number
}

export type TrendDirection = 'bullish' | 'bearish' | 'sideways' | 'transition' | 'insufficient'
export type TrendRegime = 'trend' | 'range' | 'transition' | 'unknown'
export type TrendAlignment = 'aligned-bullish' | 'aligned-bearish' | 'mixed' | 'range' | 'insufficient'
export type WyckoffPhaseCandidate = 'accumulation' | 'markup' | 'distribution' | 'markdown' | 'reaccumulation' | 'redistribution' | 'indeterminate'
export type WyckoffEventKind = 'spring' | 'test' | 'sign-of-strength' | 'last-point-of-support' | 'upthrust' | 'upthrust-after-distribution' | 'sign-of-weakness' | 'last-point-of-supply'

export interface TrendAssessment {
  horizon: 'short' | 'medium' | 'long'
  direction: TrendDirection
  regime: TrendRegime
  score: number
  confidence: number
  signals: Array<{ id: string; tone: 'positive' | 'negative' | 'neutral'; weight: number; value?: number | null }>
}

export interface MultiTimeframeTrend {
  short: TrendAssessment
  medium: TrendAssessment
  long: TrendAssessment
  alignment: TrendAlignment
}

export interface WyckoffAssessment {
  phaseCandidate: WyckoffPhaseCandidate
  confidence: number
  testState: 'none' | 'pending' | 'confirmed' | 'invalidated'
  range: { lookback: number; lower: number; upper: number; position: number; widthPercent: number | null } | null
  events: Array<{ kind: WyckoffEventKind; status: 'candidate' | 'confirmed' | 'invalidated'; at: string; level: number | null }>
  supportingEvidence: string[]
  opposingEvidence: string[]
  confirmation: string[]
  invalidation: string[]
}

export interface MarketDailyBrief {
  cadence: 'daily-bar'
  periodKey: string
  narrator: 'deterministic-v1'
  overallDirection: TrendDirection
  confidence: number
  alignment: TrendAlignment
  phaseCandidate: WyckoffPhaseCandidate
  headline: string
  observations: string[]
  watchFor: string[]
  risks: string[]
}

export interface MonitorSnapshot {
  id: string
  asset: MonitorAsset
  capturedAt: string
  trigger: MonitorTrigger
  strategyId: string
  fingerprint: string
  metrics: {
    lastPrice: number
    lastBarAt: string
    change1dPercent: number | null
    change5dPercent: number | null
    rangePosition60d: number | null
    volumeRatio20d: number | null
    weeklyChangePercent: number | null
    intraday: {
      available: boolean
      latestAt: string | null
      latestChangePercent: number | null
      fourHourChangePercent: number | null
      volumeRatio: number | null
      abnormal: boolean
      note: string
    }
  }
  hypothesis: {
    id: 'demand-control' | 'supply-control' | 'balanced-range'
    label: string
    bias: 'bullish' | 'bearish' | 'neutral'
    confidence: number
    summary: string
    confirm: string[]
    invalidate: string[]
    alternatives: string[]
  }
  evidence: EvidenceItem[]
  trend?: MultiTimeframeTrend
  wyckoff?: WyckoffAssessment
  dailyBrief?: MarketDailyBrief
  context: Record<string, unknown> & { recentNews?: Array<{ title: string; time: string; source: string | null }> }
  sourceHealth: SourceHealth[]
  chart: { daily: HistoricalBar[]; intraday: HistoricalBar[]; dailyMeta: BarMeta; intradayMeta: BarMeta | null }
}

export interface MonitorAlert {
  id: string
  asset: MonitorAsset
  createdAt: string
  snapshotId: string
  severity: 'info' | 'warning'
  title: string
  message: string
  fingerprint: string
}

export interface MonitorReceipt {
  id: string
  asset: MonitorAsset
  requestedAt: string
  completedAt?: string
  trigger: MonitorTrigger
  outcome: 'stored' | 'duplicate' | 'failed'
  snapshotId?: string
  error?: string
  strategyId?: string
  durationMs?: number
  sourceHealth?: Array<Pick<SourceHealth, 'id' | 'label' | 'provider' | 'status' | 'asOf'>>
}

export interface MonitorHealthReport {
  schemaVersion: 1
  asset: MonitorAsset
  generatedAt: string
  window: {
    hours: 24 | 72
    from: string
    to: string
    firstSampleAt: string | null
    lastSampleAt: string | null
    sampleLimit: number
    truncated: boolean
  }
  summary: {
    attempts: number
    successful: number
    failed: number
    stored: number
    duplicates: number
    scheduled: number
    manual: number
    successRatePercent: number | null
    consecutiveFailures: number
    recoveries: number
    lastSuccessAt: string | null
    lastFailureAt: string | null
    durationSamples: number
    averageDurationMs: number | null
    p95DurationMs: number | null
    scansWithSourceChecks: number
    scansWithSourceIssues: number
  }
  sources: Array<{
    id: string
    label: string
    provider: string
    samples: number
    ok: number
    degraded: number
    unavailable: number
    recoveries: number
    latestStatus: SourceHealth['status']
    lastCheckedAt: string
    lastDataAt: string | null
  }>
  recent: MonitorReceipt[]
}

export interface MonitorSchedulerStatus {
  running: boolean
  backgroundEnabled: boolean
  intervalMinutes: number
  checkedAt: string | null
  error: string | null
  assets: Array<{
    asset: MonitorAsset
    enabled: boolean
    scanning: boolean
    nextScanAt: string | null
    lastReceipt: MonitorReceipt | null
    lastError: string | null
  }>
}

export interface ScanResult {
  snapshot: MonitorSnapshot
  stored: boolean
  alert: MonitorAlert | null
  receipt: MonitorReceipt
}

export interface MonitorEvaluation {
  asset: MonitorAsset
  samples: number
  resolved: number
  directionalAccuracy: number | null
  averageForwardChangePercent: number | null
  rows: Array<{
    capturedAt: string
    hypothesis: 'bullish' | 'bearish' | 'neutral'
    confidence: number
    nextCapturedAt: string | null
    forwardChangePercent: number | null
    correct: boolean | null
  }>
}

function query(asset?: MonitorAsset, limit = 100, strategyId?: string): string {
  const params = new URLSearchParams({ limit: String(limit) })
  if (asset) params.set('asset', asset)
  if (strategyId) params.set('strategyId', strategyId)
  return params.toString()
}

export const marketMonitorApi = {
  health: (asset: MonitorAsset, hours: 24 | 72 = 24) => fetchJson<MonitorHealthReport>(`/api/market-monitor/health?asset=${asset}&hours=${hours}`),
  status: () => fetchJson<MonitorSchedulerStatus>('/api/market-monitor/status'),
  settings: () => fetchJson<MonitorSettings>('/api/market-monitor/settings'),
  strategies: () => fetchJson<{ strategies: MonitorStrategy[] }>('/api/market-monitor/strategies'),
  contextProviders: () => fetchJson<{ providers: MonitorContextProvider[] }>('/api/market-monitor/context-providers'),
  saveSettings: (settings: MonitorSettings) => fetchJson<MonitorSettings>('/api/market-monitor/settings', { method: 'PUT', headers, body: JSON.stringify(settings) }),
  scan: (asset: MonitorAsset, trigger: MonitorTrigger = 'manual') => fetchJson<ScanResult>('/api/market-monitor/scan', { method: 'POST', headers, body: JSON.stringify({ asset, trigger }) }),
  snapshots: (asset?: MonitorAsset, limit = 100, strategyId?: string) => fetchJson<{ snapshots: MonitorSnapshot[]; count: number }>(`/api/market-monitor/snapshots?${query(asset, limit, strategyId)}`),
  alerts: (asset?: MonitorAsset, limit = 100) => fetchJson<{ alerts: MonitorAlert[]; count: number }>(`/api/market-monitor/alerts?${query(asset, limit)}`),
  receipts: (asset?: MonitorAsset, limit = 100) => fetchJson<{ receipts: MonitorReceipt[]; count: number }>(`/api/market-monitor/receipts?${query(asset, limit)}`),
  evaluation: (asset: MonitorAsset) => fetchJson<MonitorEvaluation>(`/api/market-monitor/evaluation?asset=${asset}`),
}
