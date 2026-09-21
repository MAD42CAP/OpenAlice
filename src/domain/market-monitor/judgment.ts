import { assertFreshBars, closedBars } from './bar-policy.js'
import { reviewSessionDate } from './review.js'
import type { JevReport } from './typesafe-types.js'
import type { MarketMonitorReceipt, MarketMonitorSnapshot, TrendDirection, TrendHorizon } from './types.js'

export type JudgmentDirection = 'bullish' | 'bearish' | 'range' | 'unclear' | 'insufficient'
export type JudgmentReason = 'rules-bullish' | 'rules-bearish' | 'range-observed' | 'rules-mixed' | 'daily-missing' | 'hourly-missing' | 'structure-conflict' | 'structure-pending' | 'structure-agrees' | 'structure-unknown' | 'context-partial' | 'earnings-near' | 'latest-scan-failed'
export interface MarketJudgmentReport {
  protocol: 'evidence-summary-v1'
  asset: MarketMonitorSnapshot['asset']
  strategyId: string
  snapshotId: string
  generatedAt: string
  basis: { capturedAt: string; dailyAt: string | null; hourlyAt: string | null }
  quality: 'complete' | 'partial' | 'insufficient'
  horizons: Record<TrendHorizon, {
    sessions: number
    direction: JudgmentDirection
    rules: TrendDirection
    agreement: 'aligned' | 'mixed' | 'limited'
    reasons: JudgmentReason[]
    risks: JudgmentReason[]
  }>
  structure: { phase: string; direction: 'bullish' | 'bearish' | 'unclear'; confirmed: boolean; lower: number | null; upper: number | null; confirmation: string[]; invalidation: string[] }
  context: { currentFields: string[]; referenceFields: string[]; newsCount: number; filingsCount: number; earningsAt: string | null }
  jev: { status: 'current' | 'different-basis' | 'stale' | 'missing' | 'unavailable'; issuedAt: string | null; directions: Record<TrendHorizon, 'up' | 'flat' | 'down' | 'insufficient'> | null }
}

/** A current-evidence synthesis, not a calibrated forecast or a new historical
 * prediction. Price-derived methods form one evidence family. Jev stays an
 * independently archived experiment and cannot outvote observable structure. */
export function buildMarketJudgment(snapshot: MarketMonitorSnapshot, at: Date, jev?: JevReport | null, receipt?: MarketMonitorReceipt | null): MarketJudgmentReport {
  const basis = snapshot.analysisBasis
  const usable = (interval: '1d' | '1h') => {
    if (!basis?.closedBarsOnly || !Number.isFinite(Date.parse(snapshot.capturedAt)) || Date.parse(snapshot.capturedAt) > at.getTime()) return false
    const date = interval === '1d' ? basis.dailyAt : basis.hourlyAt
    const source = snapshot.sourceHealth.find(s => s.id === (interval === '1d' ? 'daily-bars' : 'intraday-bars'))
    if (!date || !source || source.status === 'unavailable') return false
    const bars = interval === '1d' ? snapshot.chart.daily : snapshot.chart.intraday
    const sample = closedBars(bars, snapshot.asset, interval, at).filter(b => b.date === date || interval === '1d' && b.date.slice(0, 10) === date.slice(0, 10))
    try { assertFreshBars(sample, snapshot.asset, interval, at); return true } catch { return false }
  }
  const daily = usable('1d'), hourly = usable('1h') && snapshot.metrics.intraday.available
  const failedScan = receipt?.asset === snapshot.asset && receipt.strategyId === snapshot.strategyId && receipt.outcome === 'failed' && Date.parse(receipt.completedAt ?? receipt.requestedAt) >= Date.parse(snapshot.capturedAt)
  const w = snapshot.wyckoff
  const phase = w?.phaseCandidate ?? 'indeterminate'
  const structureDirection = ['accumulation', 'reaccumulation', 'markup'].includes(phase) ? 'bullish' : ['distribution', 'redistribution', 'markdown'].includes(phase) ? 'bearish' : 'unclear'
  const matchingEvents = structureDirection === 'bullish' ? ['spring', 'sign-of-strength', 'last-point-of-support'] : ['upthrust', 'upthrust-after-distribution', 'sign-of-weakness', 'last-point-of-supply']
  const confirmed = structureDirection !== 'unclear' && w?.testState === 'confirmed' && w.events.some(e => e.status === 'confirmed' && matchingEvents.includes(e.kind) && Number.isFinite(Date.parse(e.at)) && Date.parse(e.at) <= Date.parse(snapshot.capturedAt))
  const range = w?.range && Number.isFinite(w.range.lower) && Number.isFinite(w.range.upper) && w.range.lower > 0 && w.range.upper > w.range.lower ? w.range : null
  const insideRange = range && snapshot.metrics.lastPrice >= range.lower && snapshot.metrics.lastPrice <= range.upper
  const contextSources = snapshot.sourceHealth.filter(s => s.id !== 'daily-bars' && s.id !== 'intraday-bars')
  const contextTtl = snapshot.asset === 'BTC' ? 30 * 60_000 : 24 * 3_600_000
  const contextCurrent = contextSources.length > 0 && contextSources.every(s => s.status === 'ok' && !s.retained && s.asOf && Date.parse(s.asOf) <= at.getTime() && at.getTime() - Date.parse(s.asOf) <= contextTtl)
  const numericFields = Object.entries(snapshot.context).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)).map(([key]) => key)
  const earningsAt = contextCurrent && snapshot.context.nextEarningsAt && Number.isFinite(Date.parse(snapshot.context.nextEarningsAt)) ? snapshot.context.nextEarningsAt : null
  const context = { currentFields: contextCurrent ? numericFields : [], referenceFields: contextCurrent ? [] : numericFields,
    newsCount: snapshot.context.recentNews?.length ?? 0, filingsCount: snapshot.context.recentFilings?.length ?? 0, earningsAt }
  const horizons = Object.fromEntries((['short', 'medium', 'long'] as const).map(h => {
    const rules = snapshot.trend?.[h].direction ?? 'insufficient'
    const sessions = h === 'short' ? 1 : h === 'medium' ? snapshot.asset === 'BTC' ? 7 : 5 : snapshot.asset === 'BTC' ? 30 : 20
    const reasons: JudgmentReason[] = [], risks: JudgmentReason[] = []
    let direction: JudgmentDirection = rules === 'bullish' || rules === 'bearish' ? rules : rules === 'sideways' && insideRange ? 'range' : rules === 'insufficient' ? 'insufficient' : 'unclear'
    let agreement: 'aligned' | 'mixed' | 'limited' = 'limited'
    if (!daily) { direction = 'insufficient'; reasons.push('daily-missing') }
    else if (h === 'short' && !hourly) { direction = 'insufficient'; reasons.push('hourly-missing') }
    else {
      reasons.push(direction === 'bullish' ? 'rules-bullish' : direction === 'bearish' ? 'rules-bearish' : direction === 'range' ? 'range-observed' : 'rules-mixed')
      if (structureDirection === 'unclear') risks.push('structure-unknown')
      else if (rules === 'bullish' || rules === 'bearish') {
        if (structureDirection !== rules) {
          agreement = 'mixed'
          if (confirmed) { direction = 'unclear'; reasons.unshift('structure-conflict') }
          else risks.push('structure-pending')
        } else if (confirmed) { agreement = 'aligned'; reasons.push('structure-agrees') }
        else risks.push('structure-pending')
      } else if (confirmed && rules !== 'insufficient') {
        direction = 'unclear'; agreement = 'mixed'; reasons.unshift('structure-conflict')
      }
    }
    if (!contextCurrent) risks.push('context-partial')
    if (failedScan) risks.push('latest-scan-failed')
    // A calendar date is not a midnight event timestamp. Include today and
    // allow weekends/holiday slack; this is an upcoming-event warning, not a
    // claim that a guessed calendar supplies the exact future session window.
    const days = h === 'short' ? 4 : h === 'medium' ? 10 : 40
    const today = reviewSessionDate(snapshot.asset, at.toISOString())
    const calendarEnd = new Date(Date.parse(today) + days * 86400000).toISOString().slice(0, 10)
    if (earningsAt && earningsAt.slice(0, 10) >= today && earningsAt.slice(0, 10) <= calendarEnd) risks.push('earnings-near')
    return [h, { sessions, direction, rules, agreement, reasons, risks }]
  })) as MarketJudgmentReport['horizons']
  const forecast = jev?.asset === snapshot.asset ? jev.rows.filter(row => row.forecast.asset === snapshot.asset && row.forecast.basis.strategyId === snapshot.strategyId && Date.parse(row.forecast.issuedAt) <= at.getTime() && row.outcomes.every(o => o.outcome.status !== 'unverified')).at(-1)?.forecast : undefined
  const jevStatus = !jev ? 'unavailable' : !forecast ? 'missing' : reviewSessionDate(snapshot.asset, forecast.issuedAt) !== reviewSessionDate(snapshot.asset, at.toISOString()) ? 'stale' : forecast.basis.snapshotId !== snapshot.id ? 'different-basis' : 'current'
  return { protocol: 'evidence-summary-v1', asset: snapshot.asset, strategyId: snapshot.strategyId, snapshotId: snapshot.id, generatedAt: at.toISOString(),
    basis: { capturedAt: snapshot.capturedAt, dailyAt: basis?.dailyAt ?? null, hourlyAt: basis?.hourlyAt ?? null },
    quality: !daily ? 'insufficient' : !hourly || !contextCurrent || failedScan || snapshot.sourceHealth.some(s => s.status !== 'ok') ? 'partial' : 'complete',
    horizons, structure: { phase, direction: structureDirection, confirmed: Boolean(confirmed), lower: range?.lower ?? null, upper: range?.upper ?? null, confirmation: w?.confirmation ?? [], invalidation: w?.invalidation ?? [] }, context,
    jev: { status: jevStatus, issuedAt: forecast?.issuedAt ?? null, directions: forecast ? Object.fromEntries((['short', 'medium', 'long'] as const).map(h => [h, forecast.horizons[h].adequacy.choice === 'adequate' && ['up', 'flat', 'down'].includes(forecast.horizons[h].answer.choice) ? forecast.horizons[h].answer.choice : 'insufficient'])) as NonNullable<MarketJudgmentReport['jev']['directions']> : null },
  }
}
