import { fetchJson, headers } from './client'
import type { MonitorAsset } from './market-monitor'
import type { ExperimentReport } from './forecast-experiment-types'
export type { ExperimentReport } from './forecast-experiment-types'
const path = '/api/market-monitor/forecast-experiment'
export const forecastExperimentApi = {
  read: (asset: MonitorAsset, signal?: AbortSignal) => fetchJson<ExperimentReport>(`${path}?asset=${asset}`, { signal, cache: 'no-store' }),
  collect: (asset: MonitorAsset) => fetchJson<{ id: string; issuedAt: string }>(path, { method: 'POST', headers, body: JSON.stringify({ asset }), signal: AbortSignal.timeout(120_000) }),
}
