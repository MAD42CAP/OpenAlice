import { fetchJson, headers } from './client'
import type { MonitorAsset } from './market-monitor'
import type { ThesisDraft, ThesisReport } from './market-thesis-types'
export const marketThesisApi = {
  read: (asset: MonitorAsset, signal?: AbortSignal) => fetchJson<ThesisReport>(`/api/market-monitor/thesis?asset=${asset}`, { signal, cache: 'no-store' }),
  save: (asset: MonitorAsset, expectedRevision: number, draft: ThesisDraft) => fetchJson<ThesisReport>('/api/market-monitor/thesis', { method: 'PUT', headers, body: JSON.stringify({ asset, expectedRevision, draft }) }),
  check: (asset: MonitorAsset) => fetchJson<ThesisReport>('/api/market-monitor/thesis/check', { method: 'POST', headers, body: JSON.stringify({ asset }) }),
}
