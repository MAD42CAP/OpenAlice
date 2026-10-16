import { fetchJson, headers } from './client'
import type { MonitorAsset } from './market-monitor'
import type { InvestmentReport, MarketIntelligence, ResearchReport, ResearchSnapshot, ResearchStatus } from './market-intelligence-types'

export interface IntelligenceJob {
  state: 'idle' | 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'blocked'
  message: string
  updatedAt: string | null
  runId?: string | null
}
export interface MarketIntelligenceReport {
  asset: MonitorAsset
  generatedAt: string
  market: MarketIntelligence | null
  research: { reports: ResearchReport[]; snapshots: ResearchSnapshot[]; latest: ResearchSnapshot | null; status: ResearchStatus }
  investment: InvestmentReport
  job: IntelligenceJob
  illustrative?: boolean
}
export type ResearchImport = { url: string } | { url: string; title: string; text: string; publishedAt?: string }
const base = '/api/market-monitor/intelligence'
const post = (path: string, body: unknown, asset: MonitorAsset = 'BTC') => fetchJson<MarketIntelligenceReport>(`${base}/${path}?asset=${asset}`, { method: 'POST', headers, body: JSON.stringify(body) })
export const marketIntelligenceApi = {
  read: (asset: MonitorAsset, signal?: AbortSignal) => fetchJson<MarketIntelligenceReport>(`${base}?asset=${asset}`, { signal, cache: 'no-store' }),
  discover: (force = false) => post('discover', { force }),
  importReport: (input: ResearchImport) => post('import', input),
  run: (asset: MonitorAsset, force = false) => post('run', { force }, asset),
}
