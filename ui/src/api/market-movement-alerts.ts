import { fetchJson, headers } from './client'
import type { MonitorAsset } from './market-monitor'
import type { MovementReport as ServerMovementReport, MovementCreate } from '../../../src/domain/market-monitor/movement-alert-types.js'
export type { MovementPrice, MovementEvent, MovementLeg, MovementPlan, MovementCreate, MovementRisk } from '../../../src/domain/market-monitor/movement-alert-types.js'
export type { MovementRiskBoundary as MovementBoundary } from '../../../src/domain/market-monitor/movement-risk-types.js'
export type MovementReport = ServerMovementReport & { illustrative?: boolean }
export const movementErrorCodes = ['movement-invalid', 'movement-active-plan', 'movement-price-unavailable', 'movement-state-unavailable', 'movement-not-found'] as const
export type MovementError = typeof movementErrorCodes[number] | 'read' | 'request'
export const marketMovementApi = {
  read: (asset: MonitorAsset, signal?: AbortSignal) => fetchJson<MovementReport>(`/api/market-monitor/movement-alerts?asset=${asset}`, { signal, cache: 'no-store' }),
  create: (input: MovementCreate, signal?: AbortSignal) => fetchJson<MovementReport>('/api/market-monitor/movement-alerts', { method: 'POST', headers, body: JSON.stringify(input), signal }),
  cancel: (asset: MonitorAsset, id: string, signal?: AbortSignal) => fetchJson<MovementReport>(`/api/market-monitor/movement-alerts/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers, body: JSON.stringify({ asset }), signal }),
}
