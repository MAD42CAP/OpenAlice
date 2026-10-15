import { fetchJson, headers } from './client'
import type { MonitorAsset } from './market-monitor'
import type { ForwardReport } from './forecast-validation-types'
export type { ForwardReport } from './forecast-validation-types'
const path = '/api/market-monitor/forecast-validation'
export const forecastValidationApi = {
  read: (asset: MonitorAsset, signal?: AbortSignal) => fetchJson<ForwardReport>(`${path}?asset=${asset}`, { signal, cache: 'no-store' }),
  collect: (asset: MonitorAsset) => fetchJson<unknown>(path, { method: 'POST', headers, body: JSON.stringify({ asset }), signal: AbortSignal.timeout(120_000) }),
}
