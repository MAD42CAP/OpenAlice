import { createContext, useContext } from 'react'
import type { MonitorAsset } from '../../api/market-monitor'
import type { MarketIntelligenceReport } from '../../api/market-intelligence'

/** Share the workspace's existing read, without adding another full-report poll. */
export const MarketIntelligenceReadContext = createContext<{
  asset: MonitorAsset; report: MarketIntelligenceReport | null; loading: boolean; error: string | null
} | null>(null)
export const useMarketIntelligenceRead = () => useContext(MarketIntelligenceReadContext)
