import type { OhlcvBar } from '../market-data/bars/index.js'
import { closedBars } from './bar-policy.js'
import { firstPerOutcomeWindow } from './review-cohort.js'
import type { MarketAnalysisArchive } from './replay.js'
import type { MarketMonitorStore } from './store.js'
import type { MarketAiNarration, MarketMonitorAsset, MarketMonitorSnapshot, TrendDirection, TrendHorizon } from './types.js'

export type ReviewWindow = 7 | 30 | 90
export type ReviewHorizon = 'day' | 'week' | 'month'
export type ReviewStatus = 'complete' | 'pending' | 'missing-data' | 'unverified'
export type ReviewVerdict = 'supported' | 'opposed' | 'flat' | 'not-scored'
export interface ReviewOutcome {
  horizon: ReviewHorizon
  trendHorizon: TrendHorizon
  targetBars: number
  observedBars: number
  status: ReviewStatus
  direction: TrendDirection
  verdict: ReviewVerdict
  start: string | null
  end: string | null
  entry: number | null
  close: number | null
  changePercent: number | null
  highPercent: number | null
  lowPercent: number | null
  range: { above: number; below: number; inside: number } | null
}
export type ReviewOriginal = Pick<MarketMonitorSnapshot, 'capturedAt' | 'metrics' | 'hypothesis' | 'trend' | 'wyckoff' | 'dailyBrief' | 'evidence' | 'sourceHealth'>
export type ReviewNarration = Pick<MarketAiNarration, 'generatedAt' | 'headline' | 'summary' | 'shortTerm' | 'mediumTerm' | 'longTerm' | 'evidence' | 'risks' | 'watchFor'>
export interface ReviewCase {
  id: string
  kind: 'rules' | 'narration'
  snapshotId: string | null
  issuedAt: string
  sessionDate: string
  strategyVersion: number | null
  archiveStatus: 'verified' | 'unavailable' | 'invalid'
  original: ReviewOriginal | null
  narration: ReviewNarration | null
  originalProvider: string | null
  outcomeProvider: string | null
  providerChanged: boolean
  path: Array<Pick<OhlcvBar, 'date' | 'open' | 'high' | 'low' | 'close'>>
  outcomes: ReviewOutcome[]
}
export interface ReviewSummary {
  strategyVersion: number | null
  horizon: ReviewHorizon
  total: number
  complete: number
  uniqueWindows: number
  duplicateWindows: number
  pending: number
  excluded: number
  supported: number
  opposed: number
  flat: number
  nonDirectional: number
  scored: number
  agreementPercent: number | null
  alwaysBullishPercent: number | null
  /** Descriptive overlapping observations, never independent trading trials. */
  cases: string[]
}
export type ReviewLessonCode = 'collect-more' | 'direction-misses' | 'path-risk' | 'mixed-trends' | 'narrative-review' | 'archive-gap' | 'feed-change'
export interface ReviewLesson { code: ReviewLessonCode; count: number; caseIds: string[] }
export interface MarketReviewReport {
  illustrative?: boolean
  schemaVersion: 1
  policy: 'forward-sessions-v1'
  asset: MarketMonitorAsset
  strategyId: string
  generatedAt: string
  windowDays: ReviewWindow
  from: string
  oldestObservationAt: string | null
  historyTruncated: boolean
  flatThresholdPercent: 0.25
  rows: ReviewCase[]
  summaries: ReviewSummary[]
  lessons: ReviewLesson[]
}

const DAY = 86_400_000
const REVIEW_SNAPSHOT_LIMIT = 20_000
export function reviewSessionDate(asset: MarketMonitorAsset, at: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: asset === 'BTC' ? 'UTC' : 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
}
function horizons(asset: MarketMonitorAsset): Array<{ horizon: ReviewHorizon; trendHorizon: TrendHorizon; targetBars: number }> {
  return [
    { horizon: 'day', trendHorizon: 'short', targetBars: 1 },
    { horizon: 'week', trendHorizon: 'medium', targetBars: asset === 'BTC' ? 7 : 5 },
    { horizon: 'month', trendHorizon: 'long', targetBars: asset === 'BTC' ? 30 : 20 },
  ]
}
function original(snapshot: MarketMonitorSnapshot): ReviewOriginal {
  const { capturedAt, metrics, hypothesis, trend, wyckoff, dailyBrief, evidence, sourceHealth } = snapshot
  return { capturedAt, metrics, hypothesis, trend, wyckoff, dailyBrief, evidence, sourceHealth }
}
function narrative(row: MarketAiNarration): ReviewNarration {
  const { generatedAt, headline, summary, shortTerm, mediumTerm, longTerm, evidence, risks, watchFor } = row
  return { generatedAt, headline, summary, shortTerm, mediumTerm, longTerm, evidence, risks, watchFor }
}
function validBar(bar: OhlcvBar): boolean {
  return [bar.open, bar.high, bar.low, bar.close].every(value => Number.isFinite(value) && value > 0)
    && bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close)
}

/** Never backdate a forecast to its last known close. Entry is the first daily
 * opening AFTER its publication's session date. Stock windows count observed
 * sessions; the provider, not a guessed holiday calendar, defines their dates. */
export function reviewOutcomes(row: ReviewCase, asset: MarketMonitorAsset, bars: OhlcvBar[], at: Date): ReviewOutcome[] {
  const ordered = closedBars(bars, asset, '1d', at).slice().sort((a, b) => a.date.localeCompare(b.date))
  const forward = ordered.filter(bar => bar.date.slice(0, 10) > row.sessionDate)
  const dateCounts = new Map<string, number>()
  forward.forEach(bar => { const day = bar.date.slice(0, 10); dateCounts.set(day, (dateCounts.get(day) ?? 0) + 1) })
  return horizons(asset).map(window => {
    const path = forward.slice(0, window.targetBars)
    const direction = row.original?.trend?.[window.trendHorizon].direction ?? 'insufficient'
    const result: ReviewOutcome = { ...window, observedBars: path.length, direction, status: 'pending', verdict: 'not-scored', start: null, end: null, entry: null, close: null, changePercent: null, highPercent: null, lowPercent: null, range: null }
    if (row.archiveStatus !== 'verified') return { ...result, status: 'unverified' }
    // A missing left boundary could silently select a later, more favorable entry.
    // Refuse it. Equity closure gaps up to four calendar days allow weekends and
    // one holiday; longer closures require an explicit calendar/data review.
    const maxGap = asset === 'BTC' ? DAY : 4 * DAY
    const dates = [row.sessionDate, ...path.map(bar => bar.date.slice(0, 10))]
    const gap = dates.some((day, index) => {
      if (!index) return false
      const previous = Date.parse(dates[index - 1]!), current = Date.parse(day)
      if (current - previous > maxGap || current <= previous) return true
      // Without an exchange calendar, a missing weekday may be a holiday or a
      // feed hole. Exclude it rather than silently shifting the entry/horizon.
      if (asset !== 'BTC') for (let missing = previous + DAY; missing < current; missing += DAY) {
        const weekday = new Date(missing).getUTCDay()
        if (weekday !== 0 && weekday !== 6) return true
      }
      return false
    })
    const coversOrigin = ordered.some(bar => bar.date.slice(0, 10) <= row.sessionDate)
    const invalid = !coversOrigin || gap || path.some(bar => !validBar(bar) || dateCounts.get(bar.date.slice(0, 10))! > 1)
    // No data while the feed is behind is missing data, not a still-open horizon.
    const latest = ordered.at(-1)?.date.slice(0, 10)
    const feedBehind = !latest || Date.parse(reviewSessionDate(asset, at.toISOString())) - Date.parse(latest) > maxGap
    if (invalid || (path.length < window.targetBars && feedBehind)) return { ...result, status: 'missing-data' }
    if (path.length < window.targetBars) return result
    const entry = path[0]!.open, close = path.at(-1)!.close
    const changePercent = (close / entry - 1) * 100
    const directional = direction === 'bullish' || direction === 'bearish'
    const verdict: ReviewVerdict = row.kind !== 'rules' || !directional ? 'not-scored'
      : Math.abs(changePercent) <= 0.25 ? 'flat'
      : (changePercent > 0) === (direction === 'bullish') ? 'supported' : 'opposed'
    const range = row.original?.wyckoff?.range
    return { ...result, status: 'complete', verdict, start: path[0]!.date.slice(0, 10), end: path.at(-1)!.date.slice(0, 10), entry, close, changePercent,
      highPercent: (Math.max(...path.map(bar => bar.high)) / entry - 1) * 100,
      lowPercent: (Math.min(...path.map(bar => bar.low)) / entry - 1) * 100,
      range: range ? { above: path.filter(bar => bar.close > range.upper).length, below: path.filter(bar => bar.close < range.lower).length, inside: path.filter(bar => bar.close >= range.lower && bar.close <= range.upper).length } : null,
    }
  })
}

export function summarizeReview(rows: ReviewCase[]): { summaries: ReviewSummary[]; lessons: ReviewLesson[] } {
  const groups = new Map<string, Array<{ row: ReviewCase; outcome: ReviewOutcome }>>()
  for (const row of rows.filter(row => row.kind === 'rules')) for (const outcome of row.outcomes) {
    const key = `${row.strategyVersion}:${outcome.horizon}`
    groups.set(key, [...(groups.get(key) ?? []), { row, outcome }])
  }
  const summaries = [...groups.values()].map(items => {
    const complete = items.filter(item => item.outcome.status === 'complete')
    const unique = firstPerOutcomeWindow(complete, item => ({ issuedAt: item.row.issuedAt, ...item.outcome }))
    const count = (verdict: ReviewVerdict) => unique.filter(item => item.outcome.verdict === verdict).length
    const scored = count('supported') + count('opposed') + count('flat')
    const directional = unique.filter(item => item.outcome.verdict !== 'not-scored')
    return { strategyVersion: items[0]!.row.strategyVersion, horizon: items[0]!.outcome.horizon, total: items.length, complete: complete.length,
      uniqueWindows: unique.length, duplicateWindows: complete.length - unique.length,
      pending: items.filter(item => item.outcome.status === 'pending').length,
      excluded: items.filter(item => item.outcome.status === 'missing-data' || item.outcome.status === 'unverified').length,
      supported: count('supported'), opposed: count('opposed'), flat: count('flat'), nonDirectional: count('not-scored'), scored,
      agreementPercent: scored ? count('supported') / scored * 100 : null,
      alwaysBullishPercent: scored ? directional.filter(item => item.outcome.changePercent! > 0.25).length / scored * 100 : null,
      cases: directional.map(item => item.row.id),
    }
  })
  const lessons: ReviewLesson[] = []
  const add = (code: ReviewLessonCode, cases: ReviewCase[]) => { if (cases.length) lessons.push({ code, count: cases.length, caseIds: cases.map(row => row.id) }) }
  const rules = rows.filter(row => row.kind === 'rules')
  if (summaries.some(summary => summary.scored < 30) || !summaries.length) lessons.push({ code: 'collect-more', count: rules.length, caseIds: [] })
  add('direction-misses', rules.filter(row => row.outcomes.some(outcome => outcome.verdict === 'opposed')))
  add('path-risk', rules.filter(row => row.outcomes.some(outcome => outcome.verdict === 'supported' && (outcome.direction === 'bullish' ? outcome.lowPercent! <= -2 : outcome.highPercent! >= 2))))
  add('mixed-trends', rules.filter(row => row.original?.trend?.alignment === 'mixed'))
  add('narrative-review', rows.filter(row => row.kind === 'narration'))
  add('archive-gap', rows.filter(row => row.archiveStatus !== 'verified'))
  add('feed-change', rows.filter(row => row.providerChanged))
  return { summaries, lessons }
}

/** Bounded, read-only projection. Never scans, fetches market data, reruns a
 * strategy on future candles, publishes prose or changes live thresholds. */
export async function buildMarketReview(store: MarketMonitorStore, asset: MarketMonitorAsset, strategyId: string, days: ReviewWindow, at: Date): Promise<MarketReviewReport> {
  const [snapshots, narrations, series] = await Promise.all([store.snapshots(asset, REVIEW_SNAPSHOT_LIMIT), store.narrations(asset, 1000), store.latestSeries(asset, strategyId)])
  const from = new Date(at.getTime() - days * DAY).toISOString()
  const ordered = snapshots.filter(row => row.strategyId === strategyId && Number.isFinite(Date.parse(row.capturedAt)) && Date.parse(row.capturedAt) <= at.getTime()).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  const incompleteBoundary = snapshots.length === REVIEW_SNAPSHOT_LIMIT && ordered[0] ? reviewSessionDate(asset, ordered[0].capturedAt) : null
  const daily = new Map<string, MarketMonitorSnapshot>()
  for (const row of ordered) {
    if (reviewSessionDate(asset, row.capturedAt) === incompleteBoundary) continue
    const key = `${reviewSessionDate(asset, row.capturedAt)}:${row.analysisInput?.strategyVersion ?? 'legacy'}`
    if (!daily.has(key)) daily.set(key, row)
  }
  const candidates = [
    ...[...daily.values()].map(snapshot => ({ issuedAt: snapshot.capturedAt, snapshot, narration: null as MarketAiNarration | null })),
    ...narrations.filter(row => row.strategyId === strategyId).map(narration => ({ issuedAt: narration.generatedAt, snapshot: null as MarketMonitorSnapshot | null, narration })),
  ].filter(row => Date.parse(row.issuedAt) >= Date.parse(from) && Date.parse(row.issuedAt) <= at.getTime()).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
  const rows: ReviewCase[] = []
  for (const candidate of candidates) {
    const id = candidate.snapshot?.id ?? candidate.narration?.basis?.snapshotId ?? null
    let archive: MarketAnalysisArchive | null = null
    let archiveStatus: ReviewCase['archiveStatus'] = 'unavailable'
    if (id) {
      try {
        archive = await store.archive(id)
        if (archive) {
          const basis = candidate.narration?.basis
          if (archive.snapshot.asset !== asset || archive.snapshot.strategyId !== strategyId
            || archive.snapshot.analysisBasis?.closedBarsOnly !== true
            || !Number.isFinite(Date.parse(archive.input.asOf))
            || Date.parse(archive.input.asOf) > Date.parse(candidate.issuedAt)
            || (candidate.snapshot && (candidate.snapshot.analysisInput?.hash !== archive.snapshot.analysisInput?.hash || candidate.snapshot.fingerprint !== archive.snapshot.fingerprint || candidate.snapshot.analysisInput?.strategyVersion !== archive.input.strategyVersion))
            || (basis && (basis.inputHash !== archive.snapshot.analysisInput?.hash || basis.fingerprint !== archive.snapshot.fingerprint || basis.strategyVersion !== archive.input.strategyVersion))) throw new Error('Invalid review basis')
          archiveStatus = 'verified'
        }
      } catch { archive = null; archiveStatus = 'invalid' }
    }
    const snapshot = archive?.snapshot ?? candidate.snapshot
    const originalProvider = snapshot?.sourceHealth.find(source => source.id === 'daily-bars')?.provider ?? null
    const outcomeProvider = series?.dailyMeta.sourceId ?? series?.dailyMeta.provider ?? null
    const row: ReviewCase = { id: candidate.narration?.id ?? id!, kind: candidate.narration ? 'narration' : 'rules', snapshotId: id,
      issuedAt: candidate.issuedAt, sessionDate: reviewSessionDate(asset, candidate.issuedAt), strategyVersion: archive?.input.strategyVersion ?? snapshot?.analysisInput?.strategyVersion ?? null, archiveStatus,
      original: snapshot ? original(snapshot) : null, narration: candidate.narration ? narrative(candidate.narration) : null,
      originalProvider, outcomeProvider, providerChanged: Boolean(originalProvider && outcomeProvider && originalProvider !== outcomeProvider), path: [], outcomes: [],
    }
    row.outcomes = reviewOutcomes(row, asset, series?.daily ?? [], at)
    row.path = closedBars(series?.daily ?? [], asset, '1d', at).filter(bar => bar.date.slice(0, 10) > row.sessionDate && validBar(bar)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, asset === 'BTC' ? 30 : 20).map(({ date, open, high, low, close }) => ({ date: date.slice(0, 10), open, high, low, close }))
    rows.push(row)
  }
  return { schemaVersion: 1, policy: 'forward-sessions-v1', asset, strategyId, generatedAt: at.toISOString(), windowDays: days, from,
    oldestObservationAt: ordered[0]?.capturedAt ?? null, historyTruncated: snapshots.length === REVIEW_SNAPSHOT_LIMIT || narrations.length === 1000,
    flatThresholdPercent: 0.25, rows, ...summarizeReview(rows),
  }
}

/** Keep the native daily agent's feedback small and traceable. Free-form AI
 * prose is never reinterpreted as a machine-scored directional prediction. */
export function reviewFeedback(report: MarketReviewReport) {
  return { policy: report.policy, generatedAt: report.generatedAt,
    guidance: 'These are descriptive, overlapping forward observations, not calibrated probabilities or trading returns. Review referenced mistakes and conditions; do not rewrite history, tune live rules from this small sample, or claim that unscored prose was validated. Any proposed rule change needs a new version and untouched future validation data.',
    summaries: report.summaries, lessons: report.lessons,
    cases: report.rows.filter(row => row.kind === 'rules' && row.outcomes.some(outcome => outcome.status === 'complete')).slice(-5).map(row => ({ id: row.id, issuedAt: row.issuedAt, strategyVersion: row.strategyVersion, phase: row.original?.wyckoff?.phaseCandidate,
      reasoning: { summary: row.original?.hypothesis.summary, confirmation: row.original?.wyckoff?.confirmation, invalidation: row.original?.wyckoff?.invalidation, opposingEvidence: row.original?.wyckoff?.opposingEvidence },
      sources: { original: row.originalProvider, outcome: row.outcomeProvider, changed: row.providerChanged }, outcomes: row.outcomes })),
  }
}
