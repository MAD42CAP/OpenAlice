import type { OhlcvBar } from '../market-data/bars/index.js'
import type { IntradayPulse, MarketMonitorAsset } from './types.js'
import { closedBars } from './bar-policy.js'

const HOUR = 3_600_000
const MIN_COMPARABLE_SESSIONS = 3
const MIN_RELATIVE_VOLUME = 0.1
const calendarSource = 'https://www.nyse.com/trade/hours-calendars'

// Published 2026–2028 cash-equity schedule, checked 2026-10-16. This finite
// schedule deliberately makes no claim about emergency closures or later years.
const closedDays = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
  '2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29', '2028-06-19', '2028-07-04', '2028-09-04', '2028-11-23', '2028-12-25',
])
const earlyCloseDays = new Set(['2026-11-27', '2026-12-24', '2027-11-26', '2028-07-03', '2028-11-24'])
const nyClock = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

export interface EquitySession {
  day: string
  known: boolean
  trading: boolean
  openMinutes: number | null
  closeMinutes: number | null
  source: string
}

/** A New York session-date lookup, not a live exchange-open assertion. */
export function regularEquitySession(day: string): EquitySession {
  const date = new Date(`${day}T12:00:00Z`)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day
  const known = valid && day >= '2026-01-01' && day <= '2028-12-31'
  const trading = known && date.getUTCDay() > 0 && date.getUTCDay() < 6 && !closedDays.has(day)
  return { day, known, trading, openMinutes: trading ? 570 : null, closeMinutes: trading ? earlyCloseDays.has(day) ? 780 : 960 : null, source: calendarSource }
}

function clock(at: number): { day: string; minutes: number; seconds: number } {
  const parts = nyClock.formatToParts(at)
  const value = (key: string) => parts.find(part => part.type === key)!.value
  return { day: `${value('year')}-${value('month')}-${value('day')}`, minutes: Number(value('hour')) * 60 + Number(value('minute')), seconds: Number(value('second')) }
}

/** End date of today's event-risk window plus the next count scheduled sessions. */
export function upcomingEquitySessionEnd(day: string, count = 5): string | null {
  if (!regularEquitySession(day).known || !Number.isInteger(count) || count < 1 || count > 20) return null
  let sessions = 0
  for (let days = 1; days <= 60; days++) {
    const candidate = new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
    const session = regularEquitySession(candidate)
    if (!session.known) return null
    if (session.trading && ++sessions === count) return candidate
  }
  return null
}

/** Version-3 freshness. Previous-session hours cannot confirm a newly open
 * session, and an old Friday is not accepted after a newer Monday close. */
export function isCurrentEquityHourlyEvidence(latestAt: string | null | undefined, at: Date): boolean {
  if (!latestAt || !Number.isFinite(at.getTime()) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(latestAt)) return false
  const stamp = Date.parse(latestAt)
  if (!Number.isFinite(stamp) || stamp % 60_000 !== 0 || stamp + HOUR > at.getTime()) return false
  const latest = clock(stamp), end = clock(stamp + HOUR), current = clock(at.getTime())
  const session = regularEquitySession(latest.day), currentSession = regularEquitySession(current.day)
  if (!currentSession.known || !session.trading || latest.day !== end.day || latest.seconds !== 0
    || ![0, 30].includes(latest.minutes % 60) || latest.minutes < session.openMinutes! || end.minutes > session.closeMinutes!) return false
  if (currentSession.trading && current.minutes >= currentSession.openMinutes! && current.minutes < currentSession.closeMinutes!) {
    return latest.day === current.day && at.getTime() - stamp <= 3 * HOUR
  }
  let expectedDay = current.day
  if (!currentSession.trading || current.minutes < currentSession.openMinutes!) {
    let found = false
    for (let days = 1; days <= 15; days++) {
      expectedDay = new Date(Date.parse(`${current.day}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10)
      const prior = regularEquitySession(expectedDay)
      if (!prior.known) return false
      if (prior.trading) { found = true; break }
    }
    if (!found) return false
  }
  if (latest.day !== expectedDay) return false
  // Providers anchor to either the clock hour (Alpaca) or 09:30 (Yahoo).
  // The final crossing half-hour bucket is always excluded.
  const slot = latest.minutes % 60
  const expectedStart = Math.floor((session.closeMinutes! - 60 - slot) / 60) * 60 + slot
  return latest.minutes === expectedStart
}

function median(values: number[]): number | null {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length ? sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2 : null
}
const rounded = (value: number | null) => value == null || !Number.isFinite(value) ? null : Number(value.toFixed(2))
const change = (latest: number, prior: number) => prior > 0 ? (latest / prior - 1) * 100 : null
const positiveBar = (bar: OhlcvBar) => [bar.open, bar.high, bar.low, bar.close].every(value => Number.isFinite(value) && value > 0)
  && bar.high >= Math.max(bar.open, bar.close, bar.low) && bar.low <= Math.min(bar.open, bar.close, bar.high)
  && bar.volume != null && Number.isFinite(bar.volume) && bar.volume > 0

export interface AnalysisHourlySelection {
  /** Qualified bars for numerical research; do not infer continuity from count. */
  bars: OhlcvBar[]
  /** Continuous qualified suffix ending at the latest eligible completed bucket. */
  continuousBars: OhlcvBar[]
  latestEligibleAt: string | null
  lastClose: number | null
  pulse: IntradayPulse
  excluded: { session: number; unfinished: number; volume: number }
  note: string
}

/** Version-3 input policy. Raw provider bars remain owned by the chart/archive. */
export function selectAnalysisHourlyBars(
  input: OhlcvBar[], asset: MarketMonitorAsset, at: Date,
  thresholds: { abnormalMovePercent: number; abnormalVolumeRatio: number } = { abnormalMovePercent: 1.5, abnormalVolumeRatio: 1.8 },
): AnalysisHourlySelection {
  const excluded = { session: 0, unfinished: 0, volume: 0 }
  const emptyPulse = (note: string, latestAt: string | null = null): IntradayPulse => ({ available: false, latestAt, latestChangePercent: null, fourHourChangePercent: null, volumeRatio: null, abnormal: false, note })
  // Crypto's historical analysis is intentionally unchanged; this branch is a
  // numerical helper for consumers that share the same session selector.
  if (asset === 'BTC') {
    const bars = closedBars(input, asset, '1h', at).slice().sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    const latest = bars.at(-1)
    const continuousBars: OhlcvBar[] = []
    for (let i = bars.length - 1; i >= 0; i--) {
      if (continuousBars.length && Date.parse(continuousBars[0]!.date) - Date.parse(bars[i]!.date) !== HOUR) break
      continuousBars.unshift(bars[i]!)
    }
    const note = 'BTC uses completed UTC hourly bars; no equity-session filter.'
    const priorVolume = bars.slice(-21, -1).map(bar => bar.volume).filter((value): value is number => value != null && Number.isFinite(value))
    const average = priorVolume.length ? priorVolume.reduce((sum, value) => sum + value, 0) / priorVolume.length : null
    const latestChangePercent = rounded(continuousBars.length >= 2 ? change(latest!.close, continuousBars.at(-2)!.close) : null)
    const fourHourChangePercent = rounded(continuousBars.length >= 5 ? change(latest!.close, continuousBars.at(-5)!.close) : null)
    const volumeRatio = rounded(latest?.volume != null && average != null && average > 0 ? latest.volume / average : null)
    const pulse: IntradayPulse = bars.length < 2 ? emptyPulse(note) : {
      available: true, latestAt: latest!.date, latestChangePercent, fourHourChangePercent, volumeRatio,
      abnormal: Math.abs(latestChangePercent ?? 0) >= thresholds.abnormalMovePercent || (volumeRatio ?? 0) >= thresholds.abnormalVolumeRatio, note,
    }
    return { bars, continuousBars, latestEligibleAt: latest?.date ?? null, lastClose: latest?.close ?? null, pulse, excluded, note }
  }
  const eligible: Array<{ bar: OhlcvBar; slot: number; day: string }> = []
  const unique = [...new Map(input.map(bar => [Date.parse(bar.date), bar])).values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  const currentClock = clock(at.getTime())
  const currentSession = regularEquitySession(currentClock.day)
  let unknownCalendar = !currentSession.known
  for (const bar of unique) {
    const stamp = Date.parse(bar.date)
    if (!Number.isFinite(stamp) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(bar.date)) { excluded.session++; continue }
    const start = clock(stamp), end = clock(stamp + HOUR)
    const session = regularEquitySession(start.day)
    unknownCalendar ||= !session.known
    if (!session.trading || start.day !== end.day || start.minutes < session.openMinutes! || end.minutes > session.closeMinutes!
      || start.seconds !== 0 || stamp % 60_000 !== 0 || ![0, 30].includes(start.minutes % 60)) { excluded.session++; continue }
    if (stamp + HOUR > at.getTime()) { excluded.unfinished++; continue }
    eligible.push({ bar, slot: start.minutes, day: start.day })
  }
  const qualified: OhlcvBar[] = []
  const baseline = new Map<string, number>()
  for (let i = 0; i < eligible.length; i++) {
    const row = eligible[i]!
    const prior = eligible.slice(0, i).filter(item => item.slot === row.slot && item.day !== row.day && positiveBar(item.bar)).slice(-20)
    const typical = prior.length >= MIN_COMPARABLE_SESSIONS ? median(prior.map(item => item.bar.volume!)) : null
    if (typical == null || !positiveBar(row.bar) || row.bar.volume! < typical * MIN_RELATIVE_VOLUME) { excluded.volume++; continue }
    qualified.push(row.bar)
    baseline.set(row.bar.date, typical)
  }
  const latest = eligible.at(-1)?.bar
  const qualifiedDates = new Set(qualified.map(bar => bar.date))
  const continuousBars: OhlcvBar[] = []
  for (let i = eligible.length - 1; i >= 0; i--) {
    const bar = eligible[i]!.bar
    if (!qualifiedDates.has(bar.date) || continuousBars.length && Date.parse(continuousBars[0]!.date) - Date.parse(bar.date) !== HOUR) break
    continuousBars.unshift(bar)
  }
  const stale = !isCurrentEquityHourlyEvidence(latest?.date, at)
  const note = `Completed New York regular-session full-hour buckets only; ${excluded.session} outside/unknown-session, ${excluded.unfinished} forming and ${excluded.volume} insufficient-volume/baseline buckets excluded. Volume compares at least ${MIN_COMPARABLE_SESSIONS} prior same-time sessions; below ${MIN_RELATIVE_VOLUME * 100}% of their median is insufficient, never bearish evidence.${unknownCalendar ? ' Session calendar unavailable outside published 2026–2028 coverage.' : ''}${stale ? ' Latest regular-session evidence is stale or its current calendar is unknown.' : ''} Scheduled calendar only; emergency closures are not verified.`
  if (stale) return { bars: [], continuousBars: [], latestEligibleAt: latest?.date ?? null, lastClose: null, pulse: emptyPulse(note, latest?.date ?? null), excluded, note }
  if (!latest || continuousBars.length < 2) {
    return { bars: qualified, continuousBars, latestEligibleAt: latest?.date ?? null, lastClose: continuousBars.at(-1)?.close ?? null, pulse: emptyPulse(note, latest?.date ?? null), excluded, note }
  }
  const latestChange = rounded(change(latest.close, continuousBars.at(-2)!.close))
  const fourHourChange = rounded(continuousBars.length >= 5 ? change(latest.close, continuousBars.at(-5)!.close) : null)
  const volumeRatio = rounded(latest.volume! / baseline.get(latest.date)!)
  const abnormal = Math.abs(latestChange ?? 0) >= thresholds.abnormalMovePercent || (volumeRatio ?? 0) >= thresholds.abnormalVolumeRatio
  const pulse = { available: true, latestAt: latest.date, latestChangePercent: latestChange, fourHourChangePercent: fourHourChange, volumeRatio, abnormal, note }
  return { bars: qualified, continuousBars, latestEligibleAt: latest.date, lastClose: latest.close, pulse, excluded, note }
}
