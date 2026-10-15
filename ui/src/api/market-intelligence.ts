import { fetchJson, headers } from './client'
import type { InvestmentReport, MarketIntelligence, ResearchReport, ResearchSnapshot, ResearchStatus } from './market-intelligence-types'

export interface IntelligenceJob {
  state: 'idle' | 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'blocked'
  message: string
  updatedAt: string | null
  runId?: string | null
}
export interface MarketIntelligenceReport {
  asset: 'BTC'
  generatedAt: string
  market: MarketIntelligence | null
  research: { reports: ResearchReport[]; snapshots: ResearchSnapshot[]; latest: ResearchSnapshot | null; status: ResearchStatus }
  investment: InvestmentReport
  job: IntelligenceJob
  illustrative?: boolean
}
export type ResearchImport = { url: string } | { url: string; title: string; text: string; publishedAt?: string }
const base = '/api/market-monitor/intelligence'
const post = (path: string, body: unknown) => fetchJson<MarketIntelligenceReport>(`${base}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
export const marketIntelligenceApi = {
  read: (signal?: AbortSignal) => fetchJson<MarketIntelligenceReport>(base, { signal, cache: 'no-store' }),
  discover: (force = false) => post('discover', { force }),
  importReport: (input: ResearchImport) => post('import', input),
  run: (force = false) => post('run', { force }),
}
