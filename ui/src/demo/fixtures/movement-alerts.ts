import type { MonitorAsset } from '../../api/market-monitor'
import type { MovementBoundary, MovementPlan, MovementReport } from '../../api/market-movement-alerts'

/** Public illustrative prices only. No demo request checks or triggers a leg. */
export function demoMovementReport(asset: MonitorAsset, plans: MovementPlan[] = []): MovementReport {
  const at = new Date().toISOString(), price = { BTC: 81123.45, TSLA: 420.15, MSTR: 188.35 }[asset]
  const provider = asset === 'BTC' ? 'coinbase' : 'alpaca', feed = asset === 'BTC' ? 'Coinbase Exchange' : 'IEX'
  const boundary = (ratio: number): MovementBoundary => ({ price: price * ratio, distancePercent: (ratio - 1) * 100, priceCrossed: false, dailyCloseConfirmed: null, confirmationStatus: 'not-evaluated-current-structure', evidenceIds: ['demo-structure'], sourceHorizon: 'short', dataAsOf: at })
  return { asset, generatedAt: at, plans: structuredClone(plans), readError: false, checkError: false, illustrative: true,
    risk: { protocol: 'market-movement-risk-v1', status: 'available', reason: null,
      reference: { asset, price, asOf: at, observedAt: at, provider, feed, priceKind: 'last-trade', status: 'fresh' },
      analysis: { snapshotId: 'demo-structure', strategyId: 'evidence-chain-v1', capturedAt: at, dataAsOf: at, provider, sourceStatus: 'ok', dailyClose: price, evidenceIds: ['demo-structure'] },
      horizons: (['short', 'medium', 'long'] as const).map((horizon, index) => ({ horizon, observationBars: ([5, 28, 180] as const)[index]!, observedBars: ([5, 28, 180] as const)[index]!, observationWindow: 'completed-daily-bars', status: 'available', reason: null,
        downside: { boundary: { ...boundary(.97), sourceHorizon: horizon }, nextBoundary: { ...boundary(.94), sourceHorizon: horizon } },
        upside: { boundary: { ...boundary(1.03), sourceHorizon: horizon }, nextBoundary: { ...boundary(1.06), sourceHorizon: horizon } },
      })),
    },
  }
}
