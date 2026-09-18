/** Read-only research panels. These observations never alter strategy scores. */
export type DashboardUnit = 'usd' | 'percent' | 'btc' | 'sats' | 'ratio' | 'index' | 'count' | 'months'
export interface DashboardSource {
  provider: string
  url?: string
  dataAt: string | null
  publishedAt?: string | null
  fetchedAt: string
  status: 'ok' | 'stale' | 'unavailable'
  detail?: string
  formula?: string
  formulaVersion?: string
}
export interface DashboardMetric {
  id: string
  label: string
  value: number | null
  unit: DashboardUnit
  description: string
  source: DashboardSource
}
export interface DashboardSeries {
  id: string
  label: string
  unit: DashboardUnit
  group: 'price' | 'derivatives' | 'cycle' | 'strategy' | 'strc'
  points: Array<{ at: string; value: number }>
  source: DashboardSource
  referenceValue?: number
  /** Calendar observations keep their UTC date; instants follow the viewer timezone. */
  timeAxis?: 'utc-date' | 'instant'
  /** Break the chart across larger gaps; omission means discrete observations. */
  maxGapMs?: number
}
export interface DashboardEvent {
  id: string
  at: string
  availableAt?: string
  label: string
  kind: 'judgment' | 'wyckoff' | 'filing' | 'dividend' | 'financing'
  detail?: string
  snapshotId?: string
  level?: number
  url?: string
}
export interface DashboardModule {
  id: string
  label: string
  metrics: DashboardMetric[]
  series: DashboardSeries[]
  events: DashboardEvent[]
  notes: string[]
}
export interface MarketDashboardReport {
  schemaVersion: 1
  asset: 'BTC' | 'TSLA' | 'MSTR'
  generatedAt: string
  windowDays: 30 | 90 | 365
  modules: DashboardModule[]
  illustrative?: boolean
}

export interface DashboardObservation {
  kind: 'scan-context' | 'research'
  asset: 'BTC' | 'TSLA' | 'MSTR'
  strategyId: string
  capturedAt: string
  snapshotId: string | null
  /** Only contemporaneous, public scalar values, never a backfilled time series. */
  metrics: DashboardMetric[]
}
