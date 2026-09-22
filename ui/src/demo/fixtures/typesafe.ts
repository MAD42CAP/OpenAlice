import type { JevForecast, JevReport } from '../../api/typesafe'
import type { MonitorAsset } from '../../api/market-monitor'

/** Deliberately illustrative: this fixture is never a real Jev evaluation. */
export function demoJevReport(asset: MonitorAsset): JevReport {
  const at = new Date().toISOString()
  const horizons = ['short', 'medium', 'long'] as const
  const forecast: JevForecast = {
    schemaVersion: 1, id: `demo-jev-${asset}`, asset, issuedAt: at, model: 'jev-1.13.0', protocol: 'jev-forward-sessions-v1',
    basis: { snapshotId: `demo-${asset}`, inputHash: 'illustrative', capturedAt: at, strategyId: 'evidence-chain-v1', strategyVersion: 2 }, inputHash: 'illustrative', recordHash: 'illustrative', state: {}, questions: {},
    horizons: Object.fromEntries(horizons.map((h, i) => [h, { bars: [1, asset === 'BTC' ? 7 : 5, asset === 'BTC' ? 30 : 20][i],
      answer: { type: 'choice', choice: i === 0 ? 'down' : 'up', confidence: 0.5,
        probabilities: i === 0 ? { up: 0.3, flat: 0.2, down: 0.5 } : i === 1 ? { up: 0.5, flat: 0.2, down: 0.3 } : { up: 0.6, flat: 0.15, down: 0.25 } }, adequacy: { type: 'choice', choice: i === 1 ? 'insufficient' : 'adequate', confidence: 0.7, probabilities: i === 1 ? { adequate: 0.3, insufficient: 0.7 } : { adequate: 0.7, insufficient: 0.3 } }, baseline: i === 0 ? 'bearish' : 'bullish' }])) as unknown as JevForecast['horizons'],
    inputTokens: 2500, durationMs: 85,
  }
  return { asset, generatedAt: at, configured: true, automatic: false, model: forecast.model, illustrative: true, historyTruncated: false, invalidRecords: 0, lastError: null,
    rows: [{ forecast, providerChanged: false, outcomes: horizons.map((h, i) => ({ horizon: h, actual: null, correct: null, brier: null, outcome: {
      horizon: (['day', 'week', 'month'] as const)[i], trendHorizon: h, targetBars: forecast.horizons[h].bars, observedBars: 0, status: 'pending', direction: forecast.horizons[h].baseline, verdict: 'not-scored', start: null, end: null, entry: null, close: null, changePercent: null, highPercent: null, lowPercent: null, range: null,
    } })) }],
    summaries: horizons.map(h => ({ horizon: h, total: 1, complete: 0, uniqueWindows: 0, duplicateWindows: 0, correct: 0, flatCalls: 0, flatOutcomes: 0, pending: 1, excluded: 0, abstained: 0, scored: 0, accuracy: null, baselineAccuracy: null, baselineCompared: 0, pairedAccuracy: null, alwaysUpAccuracy: null, brier: null,
      calibration: Array.from({ length: 5 }, (_, i) => ({ from: i / 5, to: (i + 1) / 5, count: 0, meanProbability: null, observedAccuracy: null })) })),
  }
}
