import Decimal from 'decimal.js'
import { assertFreshBars, closedBars } from './bar-policy.js'
import type { MarketMonitorAsset, MarketMonitorSnapshot } from './types.js'
import type { DashboardObservation } from './dashboard-types.js'
import { THESIS_METRICS, type ThesisEvidence, type ThesisMetric, type ThesisRevision, type ThesisEvaluation } from './thesis-types.js'

export function missingThesisEvidence(metric: ThesisMetric): ThesisEvidence {
  return { metric, value: null, unit: metric === 'daily-close' ? 'usd' : ['daily-change', 'funding-8h', 'annualized-basis'].includes(metric) ? 'percent' : metric === 'manual' ? 'text' : 'ratio',
    provider: null, dataAt: null, observedAt: null, expiresAt: null, formulaVersion: 'thesis-observation-v1', reason: metric === 'manual' ? 'manual' : 'missing' }
}
const validTime = (time: string | null, at: Date) => time !== null && Number.isFinite(Date.parse(time)) && Date.parse(time) <= at.getTime()

/** Only attributed numerical observations. No model, news-title inference or
 * relabelling of a forming quote as a completed close. */
export function collectThesisEvidence(asset: MarketMonitorAsset, snapshot: MarketMonitorSnapshot | null, research: DashboardObservation[], at: Date): ThesisEvidence[] {
  return THESIS_METRICS.map(metric => {
    const e = missingThesisEvidence(metric)
    if (metric === 'manual') return e
    if (metric === 'strategy-mnav') {
      if (asset !== 'MSTR') return e
      // Use the latest observation even if unavailable; never resurrect an old
      // healthy value after a newer failed/stale observation.
      const row = research.filter(r => r.asset === asset && r.metrics.some(m => m.id === metric) && validTime(r.capturedAt, at)).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).at(-1)
      const m = row?.metrics.find(m => m.id === metric)
      if (!m || !row) return e
      e.value = m.value; e.provider = m.source.provider; e.dataAt = m.source.dataAt; e.observedAt = row.capturedAt
      e.formulaVersion = m.source.formulaVersion ?? 'unspecified'
      e.expiresAt = validTime(e.dataAt, at) ? new Date(Date.parse(e.dataAt!) + 4 * 86400000).toISOString() : null
      e.reason = m.unit !== 'ratio' || m.source.status !== 'ok' ? 'source-unavailable' : e.formulaVersion !== 'strategy-net-bps-2026-07-23' ? 'formula-changed' : 'available'
      return freshEvidence(e, at)
    }
    if (!snapshot || snapshot.asset !== asset) return e
    e.observedAt = snapshot.capturedAt
    if (!validTime(e.observedAt, at)) { e.reason = 'invalid-time'; return e }
    if (['daily-close', 'daily-change', 'volume-ratio'].includes(metric)) {
      const source = snapshot.sourceHealth.find(s => s.id === 'daily-bars')
      e.provider = source?.provider ?? null; e.dataAt = snapshot.analysisBasis?.dailyAt ?? null
      if (!snapshot.analysisBasis?.closedBarsOnly || !source || source.status === 'unavailable') { e.reason = 'source-unavailable'; return e }
      const bars = closedBars(snapshot.chart.daily, asset, '1d', new Date(snapshot.capturedAt)).filter(b => b.date.slice(0, 10) === e.dataAt?.slice(0, 10))
      try { assertFreshBars(bars, asset, '1d', at) } catch { e.reason = 'stale'; return e }
      if (!bars.length || bars.at(-1)!.close !== snapshot.metrics.lastPrice) return e
      e.value = metric === 'daily-close' ? snapshot.metrics.lastPrice : metric === 'daily-change' ? snapshot.metrics.change1dPercent : snapshot.metrics.volumeRatio20d
      e.expiresAt = e.dataAt ? new Date(Date.parse(e.dataAt.slice(0, 10)) + (asset === 'BTC' ? 2 : 4) * 86400000).toISOString() : null
    } else {
      if (asset !== 'BTC') return e
      const field = metric === 'funding-8h' ? 'fundingRate' : metric === 'annualized-basis' ? 'annualizedBasisPercent' : 'putCallOpenInterestRatio'
      const source = snapshot.sourceHealth.find(s => s.id === 'btc-derivatives')
      e.provider = source?.provider ?? null; e.dataAt = source?.asOf ?? null
      if (!source || source.status === 'unavailable' || source.failedFields?.includes(field) || source.retained?.fields.includes(field)) { e.reason = 'source-unavailable'; return e }
      const raw = snapshot.context[field]
      e.value = typeof raw === 'number' && Number.isFinite(raw) ? new Decimal(raw).times(metric === 'funding-8h' ? 100 : 1).toNumber() : null
      e.expiresAt = validTime(e.dataAt, at) ? new Date(Date.parse(e.dataAt!) + 30 * 60000).toISOString() : null
      e.formulaVersion = 'deribit-context-v1'
    }
    e.reason = 'available'
    return freshEvidence(e, at)
  })
}

export function freshEvidence(evidence: ThesisEvidence, at: Date): ThesisEvidence {
  const e = { ...evidence }
  if (e.reason !== 'available') return e
  if (e.value === null || !Number.isFinite(e.value) || ['daily-close', 'volume-ratio', 'put-call-ratio', 'strategy-mnav'].includes(e.metric) && e.value < 0) e.reason = 'missing'
  else if (!validTime(e.dataAt, at) || !validTime(e.observedAt, at) || Date.parse(e.dataAt!) > Date.parse(e.observedAt!) || !e.expiresAt || !Number.isFinite(Date.parse(e.expiresAt))) e.reason = 'invalid-time'
  else if (at.getTime() > Date.parse(e.expiresAt)) e.reason = 'stale'
  return e
}

export function evaluateThesis(revision: ThesisRevision, evidence: ThesisEvidence[], at: Date): ThesisEvaluation {
  const rows: ThesisEvaluation['rows'] = revision.conditions.map(condition => {
    const e = freshEvidence(evidence.find(e => e.metric === condition.metric) ?? missingThesisEvidence(condition.metric), at)
    if (e.reason !== 'available' || e.value === null || condition.threshold === null) return { condition, evidence: e, result: 'unknown' }
    const compare = new Decimal(e.value).cmp(condition.threshold)
    const met = condition.operator === 'gt' ? compare > 0 : condition.operator === 'gte' ? compare >= 0 : condition.operator === 'lt' ? compare < 0 : compare <= 0
    return { condition, evidence: e, result: met ? 'met' : 'not-met' }
  })
  const supported = rows.filter(r => r.condition.kind === 'support' && r.result === 'met').length
  const triggered = rows.filter(r => r.condition.kind === 'invalidate' && r.result === 'met').length
  const unknown = rows.filter(r => r.result === 'unknown').length
  const allSupport = supported > 0 && rows.filter(r => r.condition.kind === 'support').every(r => r.result === 'met')
  return { rows, supported, triggered, unknown,
    status: !revision.enabled ? 'paused' : triggered ? 'triggered' : unknown ? 'incomplete' : allSupport ? 'supported' : 'watch' }
}
