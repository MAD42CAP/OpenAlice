import type { OhlcvBar } from '../market-data/bars/index.js'
import type { MarketMonitorAsset } from './types.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR

function newYorkClock(at: Date): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at)
  const value = (key: string) => parts.find(part => part.type === key)!.value
  return { day: `${value('year')}-${value('month')}-${value('day')}`, minutes: Number(value('hour')) * 60 + Number(value('minute')) }
}

/** Calendar dates are session identities, not instants in the viewer's timezone. */
export function closedBars(bars: OhlcvBar[], asset: MarketMonitorAsset, interval: '1d' | '1h', at: Date): OhlcvBar[] {
  const clock = newYorkClock(at)
  return bars.filter(bar => {
    if (interval === '1h') return Date.parse(bar.date) + HOUR <= at.getTime()
    const day = bar.date.slice(0, 10)
    if (!Number.isFinite(Date.parse(day))) return false
    if (asset === 'BTC') return day < at.toISOString().slice(0, 10)
    // Conservative regular-session cutoff, including a 15-minute vendor lag.
    return day < clock.day || (day === clock.day && clock.minutes >= 16 * 60 + 15)
  })
}

export function completedWeekStart(at: Date): string {
  const start = new Date(at)
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() || 7) - 1))
  return start.toISOString().slice(0, 10)
}

/** Reject stale usable data before accepting a source, so fallback can run. */
export function assertFreshBars(bars: OhlcvBar[], asset: MarketMonitorAsset, interval: '1d' | '1h', at: Date): void {
  const latest = bars.slice().sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  const stamp = latest ? Date.parse(interval === '1d' ? latest.date.slice(0, 10) : latest.date) : NaN
  const age = at.getTime() - stamp
  if (!Number.isFinite(age)) throw new Error(`Invalid ${interval} latest bar timestamp`)
  if (age < -5 * 60_000) throw new Error(`Future ${interval} bar timestamp; check source and clock`)
  let stale: boolean
  if (asset === 'BTC') {
    stale = age > (interval === '1h' ? 3 * HOUR : 2 * DAY)
  } else {
    const clock = newYorkClock(at)
    const weekday = new Date(`${clock.day}T12:00:00Z`).getUTCDay()
    const open = weekday > 0 && weekday < 6 && clock.minutes >= 10 * 60 + 30 && clock.minutes < 16 * 60 + 15
    // Outside regular hours tolerate weekends and one holiday; full exchange
    // holiday/early-close calendars remain a separate provider capability.
    stale = interval === '1h' && open ? age > 3 * HOUR : age > 4 * DAY
  }
  if (stale) throw new Error(`Stale ${interval} bars: latest ${latest!.date}, checked at ${at.toISOString()}`)
}
