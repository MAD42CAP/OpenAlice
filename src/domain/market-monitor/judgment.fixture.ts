import { analyzeEvidence } from './analysis.js'
import type { MarketMonitorSnapshot } from './types.js'

/** Public synthetic observations for hermetic judgment tests. */
export function judgmentSnapshot(): MarketMonitorSnapshot {
  const daily = Array.from({ length: 60 }, (_, i) => ({ date: new Date(Date.parse('2026-09-19T00:00:00Z') - (59 - i) * 86400000).toISOString().slice(0, 10), open: 100, close: 101, high: 110, low: 90, volume: 10 }))
  const hourly = ['2026-09-20T10:00:00Z', '2026-09-20T11:00:00Z'].map(date => ({ ...daily[0]!, date }))
  const meta = { symbol: 'BTC-USD', from: daily[0]!.date, to: daily.at(-1)!.date, bars: daily.length, source: 'vendor' as const, provider: 'test-provider' }
  const analysis = analyzeEvidence({ asset: 'BTC', asOf: new Date('2026-09-20T12:00:00Z'), dailyBars: daily, intradayBars: hourly, abnormalMovePercent: 1.5, abnormalVolumeRatio: 1.8 })
  for (const h of ['short', 'medium', 'long'] as const) analysis.trend[h].direction = 'bullish'
  analysis.wyckoff = { phaseCandidate: 'markup', confidence: 75, testState: 'confirmed', range: { lookback: 60, lower: 90, upper: 110, position: 0.55, widthPercent: 22 },
    events: [{ kind: 'sign-of-strength', status: 'confirmed', at: '2026-09-18', level: 100 }], supportingEvidence: [], opposingEvidence: [], confirmation: ['hold-breakout'], invalidation: ['return-inside-range'] }
  return { id: 'test-btc', asset: 'BTC', strategyId: 'evidence-chain-v1', capturedAt: '2026-09-20T12:00:00Z', trigger: 'manual', fingerprint: 'test', ...analysis,
    analysisBasis: { version: 2, closedBarsOnly: true, dailyAt: '2026-09-19', hourlyAt: '2026-09-20T11:00:00Z' },
    context: { fundingRate: 0, openInterest: 1000 }, sourceHealth: ['daily-bars', 'intraday-bars', 'derivatives'].map(id => ({ id, label: id, provider: 'test-provider', status: 'ok', asOf: '2026-09-20T12:00:00Z', detail: 'Synthetic data' })),
    chart: { daily, intraday: hourly, dailyMeta: meta, intradayMeta: meta },
  }
}
