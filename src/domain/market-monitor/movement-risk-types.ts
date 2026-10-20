/** Browser-safe movement-risk wire contract; no runtime or domain imports. */
export type MovementRiskTimeframe = 'short' | 'medium' | 'long'
import type { MovementPrice } from './movement-alert-types.js'

export type MovementRiskReason = 'snapshot-unavailable' | 'reference-unavailable' | 'asset-mismatch'
  | 'reference-invalid' | 'reference-outdated' | 'snapshot-invalid' | 'daily-source-unavailable'
  | 'daily-bars-invalid' | 'daily-bars-outdated' | 'daily-basis-unverified' | 'reference-close-mismatch'
  | 'insufficient-daily-bars'

export interface MovementRiskBoundary {
  price: number
  /** Signed (level / reference - 1) * 100. A crossed support can be positive. */
  distancePercent: number
  priceCrossed: boolean
  /** Current rolling extrema include the last daily bar. There is no frozen
   * earlier boundary against which a subsequent daily close can be evaluated. */
  dailyCloseConfirmed: null
  confirmationStatus: 'not-evaluated-current-structure'
  sourceHorizon: MovementRiskTimeframe
  dataAsOf: string
  evidenceIds: string[]
}
export interface MovementRiskScenario {
  boundary: MovementRiskBoundary
  /** A further observed boundary, conditional on breaking the first; not a target return. */
  nextBoundary: MovementRiskBoundary | null
}
export interface MovementRiskHorizon {
  horizon: MovementRiskTimeframe
  observationBars: 5 | 28 | 180
  observedBars: number
  observationWindow: string
  status: 'available' | 'unavailable'
  reason: 'insufficient-daily-bars' | null
  downside: MovementRiskScenario | null
  upside: MovementRiskScenario | null
}
export interface MovementRisk {
  protocol: 'market-movement-risk-v1'
  status: 'available' | 'outdated' | 'unavailable'
  reason: MovementRiskReason | null
  reference: MovementPrice | null
  analysis: {
    snapshotId: string
    strategyId: string
    capturedAt: string
    dataAsOf: string
    provider: string
    sourceStatus: 'ok' | 'degraded'
    dailyClose: number
    evidenceIds: string[]
  } | null
  horizons: MovementRiskHorizon[]
}
