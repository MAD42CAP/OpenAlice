import type { MarketJudgmentReport } from '../../api/market-judgment'
import type { MonitorAsset } from '../../api/market-monitor'
import { demoMonitorSnapshot } from './market-monitor'

/** Illustrative display contract; never a live synthesis or predictive record. */
export function demoMarketJudgment(asset: MonitorAsset, version: 'v1' | 'v2' | 'v3' = 'v1'): MarketJudgmentReport {
  const snapshot = demoMonitorSnapshot(asset)
  const report: MarketJudgmentReport = {
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
  if (version === 'v2' || version === 'v3') {
    report.protocol = version === 'v3' ? 'evidence-summary-v3' : 'evidence-summary-v2'
    report.validation = { status: 'experimental', policy: version === 'v3' ? 'evidence-summary-v3' : 'evidence-summary-v2' }
    report.jev.policy = 'jev-base-rate-v2'
    report.jev.directions = { short: 'insufficient', medium: 'insufficient', long: 'up' }
    for (const horizon of Object.values(report.horizons)) horizon.decision = horizon.direction === 'bullish' || horizon.direction === 'bearish' ? 'conditional' : 'abstain'
  }
  if (version === 'v3' && asset !== 'BTC') {
    // Synthetic event dates relative to the demo clock, not a live issuer calendar.
    const date = new Date(Date.parse(snapshot.capturedAt) + (asset === 'TSLA' ? 4 : 21) * 86_400_000).toISOString().slice(0, 10)
    report.context.earningsAt = date
    report.context.earningsEvent = { date, timing: 'after-close', verifiedAt: snapshot.capturedAt, verification: asset === 'TSLA' ? 'research-reviewed' : 'live-official',
      sourceUrl: asset === 'TSLA' ? 'https://ir.tesla.com/press-release/synthetic-demo-earnings' : 'https://www.strategy.com/press/synthetic-demo-earnings' }
    report.horizons.short = { ...report.horizons.short, direction: 'unclear', decision: 'abstain', reasons: [asset === 'TSLA' ? 'earnings-near' : 'rules-mixed'], risks: asset === 'TSLA' ? ['earnings-near'] : [] }
  }
  return report
}
