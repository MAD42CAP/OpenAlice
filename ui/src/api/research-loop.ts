import { fetchJson, headers } from './client'
import type { MonitorAsset } from './market-monitor'
import type { ResearchLoopReport } from './research-loop-types'
export type { ResearchLoopReport } from './research-loop-types'
const path = '/api/market-monitor/research-loop'
export const researchLoopApi = {
  read: (asset: MonitorAsset, signal?: AbortSignal) => fetchJson<ResearchLoopReport>(`${path}?asset=${asset}`, { signal, cache: 'no-store' }),
  run: (asset: MonitorAsset, signal?: AbortSignal) => fetchJson<ResearchLoopReport>(`${path}/run?asset=${asset}`, { method: 'POST', headers, body: '{}', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) }),
}
