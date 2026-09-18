import { fetchJson } from './client'
import type { MonitorAsset } from './market-monitor'
import type { MarketDashboardReport } from '../../../src/domain/market-monitor/dashboard-types.js'

export type { DashboardEvent, DashboardMetric, DashboardModule, DashboardSeries, DashboardSource, DashboardUnit, MarketDashboardReport } from '../../../src/domain/market-monitor/dashboard-types.js'
export type DashboardWindow = 30 | 90 | 365

export const marketDashboardApi = {
  report: (asset: MonitorAsset, days: DashboardWindow, signal?: AbortSignal) => fetchJson<MarketDashboardReport>(`/api/market-monitor/dashboard?${new URLSearchParams({ asset, days: String(days) })}`, { signal }),
}
