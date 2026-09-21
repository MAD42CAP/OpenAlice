import type { MarketJudgmentReport } from '../../api/market-judgment'
import type { MonitorAsset } from '../../api/market-monitor'
import { demoMonitorSnapshot } from './market-monitor'

/** Illustrative display contract; never a live synthesis or predictive record. */
export function demoMarketJudgment(asset: MonitorAsset): MarketJudgmentReport {
  const snapshot = demoMonitorSnapshot(asset)
  return {
    protocol: 'evidence-summary-v1', asset, strategyId: snapshot.strategyId, snapshotId: snapshot.id, generatedAt: snapshot.capturedAt,
    basis: { capturedAt: snapshot.capturedAt, dailyAt: snapshot.analysisBasis!.dailyAt, hourlyAt: snapshot.analysisBasis!.hourlyAt }, quality: 'partial',
    horizons: {
      short: { sessions: 1, direction: asset === 'BTC' ? 'bullish' : 'unclear', rules: snapshot.trend!.short.direction, agreement: 'limited', reasons: [asset === 'BTC' ? 'rules-bullish' : 'rules-mixed'], risks: ['context-partial'] },
      medium: { sessions: asset === 'BTC' ? 7 : 5, direction: asset === 'BTC' ? 'bullish' : 'range', rules: snapshot.trend!.medium.direction, agreement: asset === 'BTC' ? 'aligned' : 'limited', reasons: [asset === 'BTC' ? 'rules-bullish' : 'range-observed'], risks: [] },
      long: { sessions: asset === 'BTC' ? 30 : 20, direction: 'bullish', rules: 'bullish', agreement: 'limited', reasons: ['rules-bullish'], risks: ['structure-pending'] },
    },
    structure: { phase: snapshot.wyckoff!.phaseCandidate, direction: 'bullish', confirmed: asset === 'BTC', lower: snapshot.wyckoff!.range!.lower, upper: snapshot.wyckoff!.range!.upper, confirmation: snapshot.wyckoff!.confirmation, invalidation: snapshot.wyckoff!.invalidation },
    context: { currentFields: Object.keys(snapshot.context).filter(k => typeof snapshot.context[k] === 'number'), referenceFields: [], newsCount: snapshot.context.recentNews?.length ?? 0, filingsCount: snapshot.context.recentFilings?.length ?? 0, earningsAt: null },
    jev: { status: 'different-basis', issuedAt: snapshot.capturedAt, directions: { short: 'down', medium: 'insufficient', long: 'up' } },
  }
}
