import { fetchJson } from './client'
import type { MonitorAsset } from './market-monitor'
import type { MarketQuote } from '../../../src/domain/market-data/quotes.js'
export type { MarketQuote } from '../../../src/domain/market-data/quotes.js'

export const marketQuoteApi = {
  read: (asset: MonitorAsset, signal?: AbortSignal) => fetchJson<MarketQuote>(`/api/market-monitor/quote?asset=${asset}`, { signal, cache: 'no-store' }),
}
