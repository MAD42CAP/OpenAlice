import { fetchJson, headers } from './client'
import type { MonitorAsset } from './market-monitor'
import type { JevReport, JevAudit } from './typesafe-types'
export type { JevReport, JevAudit, JevForecast } from './typesafe-types'
export interface TypeSafeSettings { configured: boolean; automatic: boolean; model: string; illustrative?: boolean }
const root = '/api/market-monitor/typesafe'
export const typeSafeApi = {
  settings: (signal?: AbortSignal) => fetchJson<TypeSafeSettings>(`${root}/settings`, { signal, cache: 'no-store' }),
  save: (input: { apiKey?: string; automatic?: boolean; clearKey?: boolean }) => fetchJson<TypeSafeSettings>(`${root}/settings`, { method: 'PUT', headers, body: JSON.stringify(input) }),
  test: () => fetchJson<{ model: string; inputTokens: number; illustrative?: boolean }>(`${root}/test`, { method: 'POST', signal: AbortSignal.timeout(30_000) }),
  report: (asset: MonitorAsset, signal?: AbortSignal) => fetchJson<JevReport>(`${root}/report?asset=${asset}`, { signal, cache: 'no-store' }),
  generate: (asset: MonitorAsset) => fetchJson<{ id: string; issuedAt: string }>(`${root}/forecast`, { method: 'POST', headers, body: JSON.stringify({ asset }), signal: AbortSignal.timeout(120_000) }),
  audit: (input: { source: string; claim: string; sourceUrl?: string }) => fetchJson<JevAudit>(`${root}/audit`, { method: 'POST', headers, body: JSON.stringify(input), signal: AbortSignal.timeout(30_000) }),
}
