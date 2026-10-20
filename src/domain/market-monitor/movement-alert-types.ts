type MarketMonitorAsset = 'BTC' | 'TSLA' | 'MSTR'
import type { MovementRisk } from './movement-risk-types.js'
export type { MovementRisk } from './movement-risk-types.js'

export interface MovementPrice {
  asset: MarketMonitorAsset
  price: number
  asOf: string
  observedAt: string
  provider: string
  feed: string | null
  priceKind: 'last-trade' | 'completed-daily-close'
  status: 'fresh' | 'delayed'
}
export interface MovementEvent {
  id: string
  planId: string
  asset: MarketMonitorAsset
  direction: 'up' | 'down'
  percent: number
  targetPrice: number
  price: number
  asOf: string
  observedAt: string
  provider: string
  feed: string | null
  providerChanged: boolean
}
export interface MovementLeg {
  state: 'armed' | 'triggered' | 'expired' | 'cancelled'
  percent: number
  targetPrice: number
  event: MovementEvent | null
}
export interface MovementPlan {
  id: string
  asset: MarketMonitorAsset
  createdAt: string
  expiresAt: string
  anchor: MovementPrice
  up: MovementLeg | null
  down: MovementLeg | null
  lastObservedAsOf: string | null
  latestCheck: { checkedAt: string; status: 'observed' | 'unavailable' | 'expired'; reason: string | null; quote: MovementPrice | null } | null
}
export interface MovementCreate {
  asset: MarketMonitorAsset
  upPercent?: number
  downPercent?: number
  expiresInHours: number
}
export interface MovementReport {
  asset: MarketMonitorAsset
  generatedAt: string
  plans: MovementPlan[]
  risk: MovementRisk
  readError: boolean
  checkError: boolean
}
