import { fetchJson, headers } from './client'
import type { ResearchLoopReport } from './research-loop-types'
export type { ResearchLoopReport } from './research-loop-types'
const path = '/api/market-monitor/research-loop'
export const researchLoopApi = {
  read: (signal?: AbortSignal) => fetchJson<ResearchLoopReport>(`${path}?asset=BTC`, { signal, cache: 'no-store' }),
  run: (signal?: AbortSignal) => fetchJson<ResearchLoopReport>(`${path}/run`, { method: 'POST', headers, body: '{}', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) }),
}
