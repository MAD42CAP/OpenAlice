import { fetchJson, headers } from './client'
import type { MonitorAsset } from './market-monitor'
import type { ForwardProtocol, ForwardReport } from './forecast-validation-types'
export type { ForwardReport } from './forecast-validation-types'
const path = '/api/market-monitor/forecast-validation'
export const forecastValidationApi = {
  read: (asset: MonitorAsset, signal?: AbortSignal, protocol?: ForwardProtocol) => fetchJson<ForwardReport>(`${path}?asset=${asset}${protocol ? `&protocol=${protocol}` : ''}`, { signal, cache: 'no-store' }),
  collect: (asset: MonitorAsset) => fetchJson<unknown>(path, { method: 'POST', headers, body: JSON.stringify({ asset }), signal: AbortSignal.timeout(120_000) }),
}
