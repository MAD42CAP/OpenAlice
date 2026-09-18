import type { MonitorAsset } from '../../api/market-monitor'
import type { MarketReviewReport, ReviewCase, ReviewHorizon, ReviewOutcome, ReviewWindow } from '../../api/market-review'
import { demoMonitorSnapshot } from './market-monitor'

/** Explicitly synthetic scenarios, never a claim about the live archive. */
export function demoMonitorReview(asset: MonitorAsset, days: ReviewWindow = 30): MarketReviewReport {
  const base = demoMonitorSnapshot(asset)
  const price = base.metrics.lastPrice
  const range = base.wyckoff?.range
  const outcomes = (pending: boolean, opposite: boolean): ReviewOutcome[] => (['day', 'week', 'month'] as ReviewHorizon[]).map((horizon, index) => ({
    horizon, trendHorizon: (['short', 'medium', 'long'] as const)[index]!,
    targetBars: index === 0 ? 1 : index === 1 ? asset === 'BTC' ? 7 : 5 : asset === 'BTC' ? 30 : 20,
    observedBars: pending ? 0 : 1, status: pending || index > 0 ? 'pending' : 'complete',
    direction: base.trend?.[(['short', 'medium', 'long'] as const)[index]!].direction ?? 'insufficient',
    verdict: pending || index > 0 || !['bullish', 'bearish'].includes(base.trend?.short.direction ?? '') ? 'not-scored' : opposite === (base.trend?.short.direction === 'bearish') ? 'supported' : 'opposed',
    start: pending || index > 0 ? null : '2026-09-11', end: pending || index > 0 ? null : '2026-09-11',
    entry: pending || index > 0 ? null : price, close: pending || index > 0 ? null : price * (opposite ? 0.97 : 1.03),
    changePercent: pending || index > 0 ? null : opposite ? -3 : 3,
    highPercent: pending || index > 0 ? null : 5, lowPercent: pending || index > 0 ? null : -4,
    range: pending || index > 0 || !range ? null : { above: Number(price * (opposite ? 0.97 : 1.03) > range.upper), below: Number(price * (opposite ? 0.97 : 1.03) < range.lower), inside: Number(price * (opposite ? 0.97 : 1.03) >= range.lower && price * (opposite ? 0.97 : 1.03) <= range.upper) },
  }))
  const rows: ReviewCase[] = [false, true, false].map((opposite, index) => {
    const pending = index === 2
    const issuedAt = `2026-09-${pending ? '12' : '10'}T${index === 1 ? '16' : '12'}:00:00Z`
    return { id: `demo-review-${asset}-${index}`, kind: index === 1 ? 'narration' : 'rules', snapshotId: base.id, issuedAt, sessionDate: issuedAt.slice(0, 10), strategyVersion: 2, archiveStatus: 'verified',
      original: { ...base, capturedAt: issuedAt }, narration: index === 1 ? { ...base.aiNarration!, headline: 'Demo original interpretation', generatedAt: issuedAt } : null,
      originalProvider: base.sourceHealth[0]!.provider, outcomeProvider: base.sourceHealth[0]!.provider, providerChanged: false,
      path: pending ? [] : [{ date: '2026-09-11', open: price, high: price * 1.05, low: price * 0.96, close: price * (opposite ? 0.97 : 1.03) }],
      outcomes: outcomes(pending, opposite).map(outcome => index === 1 ? { ...outcome, verdict: 'not-scored' } : outcome),
    }
  })
  const scored = rows[0]!.outcomes[0]!.verdict !== 'not-scored'
  const supported = rows[0]!.outcomes[0]!.verdict === 'supported'
  return { illustrative: true, schemaVersion: 1, policy: 'forward-sessions-v1', asset, strategyId: base.strategyId, generatedAt: '2026-09-12T20:00:00Z', windowDays: days, from: '2026-08-13T20:00:00Z', oldestObservationAt: rows[0]!.issuedAt, historyTruncated: false, flatThresholdPercent: 0.25, rows,
    summaries: (['day', 'week', 'month'] as const).map(horizon => ({ strategyVersion: 2, horizon, total: 2, complete: horizon === 'day' ? 1 : 0, pending: horizon === 'day' ? 1 : 2, excluded: 0, supported: horizon === 'day' && supported ? 1 : 0, opposed: horizon === 'day' && scored && !supported ? 1 : 0, flat: 0, nonDirectional: horizon === 'day' && !scored ? 1 : 0, scored: horizon === 'day' && scored ? 1 : 0, agreementPercent: horizon === 'day' && scored ? supported ? 100 : 0 : null, alwaysBullishPercent: horizon === 'day' && scored ? 100 : null, cases: horizon === 'day' && scored ? [rows[0]!.id] : [] })),
    lessons: [{ code: 'collect-more', count: 2, caseIds: [] }, ...(supported ? [{ code: 'path-risk' as const, count: 1, caseIds: [rows[0]!.id] }] : []), { code: 'narrative-review', count: 1, caseIds: [rows[1]!.id] }],
  }
}
