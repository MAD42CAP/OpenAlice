import type { OhlcvBar } from '../market-data/bars/index.js'
import type {
  MarketMonitorMetrics,
  MultiTimeframeTrend,
  WyckoffAssessment,
  WyckoffEvent,
  WyckoffEventStatus,
  WyckoffPhaseCandidate,
  WyckoffTestState,
} from './types.js'

function sortedBars(bars: OhlcvBar[]): OhlcvBar[] {
  return bars
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
}

function rounded(value: number, digits = 2): number {
  return Number(value.toFixed(digits))
}

function mean(values: number[]): number | null {
  const finite = values.filter(Number.isFinite)
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null
}

function eventStatus(kind: 'spring' | 'upthrust' | 'sign-of-strength' | 'sign-of-weakness', event: OhlcvBar, level: number, later: OhlcvBar[]): WyckoffEventStatus {
  if (!later.length) return 'candidate'
  const latest = later.at(-1)!
  if (kind === 'spring') {
    if (later.some((bar) => bar.close < event.low)) return 'invalidated'
    const quieter = event.volume == null || latest.volume == null || latest.volume < event.volume
    return latest.low > event.low && latest.close > level && quieter ? 'confirmed' : 'candidate'
  }
  if (kind === 'upthrust') {
    if (later.some((bar) => bar.close > event.high)) return 'invalidated'
    const quieter = event.volume == null || latest.volume == null || latest.volume < event.volume
    return latest.high < event.high && latest.close < level && quieter ? 'confirmed' : 'candidate'
  }
  if (kind === 'sign-of-strength') {
    if (latest.close < level) return 'invalidated'
    return later.filter((bar) => bar.close > level).length >= 2 || latest.low >= level ? 'confirmed' : 'candidate'
  }
  if (latest.close > level) return 'invalidated'
  return later.filter((bar) => bar.close < level).length >= 2 || latest.high <= level ? 'confirmed' : 'candidate'
}

function detectEvents(bars: OhlcvBar[]): WyckoffEvent[] {
  const detected: Array<WyckoffEvent & { index: number }> = []
  const start = Math.max(20, bars.length - 15)
  for (let index = start; index < bars.length; index++) {
    const bar = bars[index]!
    const prior = bars.slice(index - 20, index)
    const lower = Math.min(...prior.map((item) => item.low))
    const upper = Math.max(...prior.map((item) => item.high))
    let kind: 'spring' | 'upthrust' | 'sign-of-strength' | 'sign-of-weakness' | null = null
    let level: number | null = null
    if (bar.low < lower && bar.close > lower) {
      kind = 'spring'
      level = lower
    } else if (bar.high > upper && bar.close < upper) {
      kind = 'upthrust'
      level = upper
    } else if (bar.close > upper) {
      kind = 'sign-of-strength'
      level = upper
    } else if (bar.close < lower) {
      kind = 'sign-of-weakness'
      level = lower
    }
    if (!kind || level == null) continue
    detected.push({
      kind,
      status: eventStatus(kind, bar, level, bars.slice(index + 1)),
      at: bar.date,
      level: rounded(level, 6),
      index,
    })
  }

  const latestStrength = detected.filter((event) => event.kind === 'sign-of-strength' && event.status !== 'invalidated').at(-1)
  if (latestStrength) {
    const test = bars.slice(latestStrength.index + 1).find((bar) => {
      const distance = latestStrength.level ? Math.abs(bar.low / latestStrength.level - 1) : Infinity
      return distance <= 0.025 && bar.close >= (latestStrength.level ?? Infinity)
    })
    if (test) detected.push({ kind: 'last-point-of-support', status: 'confirmed', at: test.date, level: latestStrength.level, index: bars.indexOf(test) })
  }
  const latestWeakness = detected.filter((event) => event.kind === 'sign-of-weakness' && event.status !== 'invalidated').at(-1)
  if (latestWeakness) {
    const test = bars.slice(latestWeakness.index + 1).find((bar) => {
      const distance = latestWeakness.level ? Math.abs(bar.high / latestWeakness.level - 1) : Infinity
      return distance <= 0.025 && bar.close <= (latestWeakness.level ?? -Infinity)
    })
    if (test) detected.push({ kind: 'last-point-of-supply', status: 'confirmed', at: test.date, level: latestWeakness.level, index: bars.indexOf(test) })
  }

  return detected
    .sort((a, b) => a.index - b.index)
    .slice(-6)
    .map(({ index: _index, ...event }) => event)
}

function phaseConditions(phase: WyckoffPhaseCandidate): Pick<WyckoffAssessment, 'confirmation' | 'invalidation'> {
  switch (phase) {
    case 'accumulation':
      return { confirmation: ['hold-range-low', 'quieter-secondary-test', 'break-range-high'], invalidation: ['close-below-spring-low', 'downside-expansion'] }
    case 'reaccumulation':
      return { confirmation: ['hold-range-midpoint', 'quieter-pullback', 'break-range-high'], invalidation: ['lose-range-low', 'long-trend-deteriorates'] }
    case 'markup':
      return { confirmation: ['hold-breakout', 'higher-low', 'positive-weekly-follow-through'], invalidation: ['return-inside-range', 'failed-upside-test'] }
    case 'distribution':
      return { confirmation: ['reject-range-high', 'weaker-secondary-test', 'break-range-low'], invalidation: ['close-above-upthrust-high', 'upside-expansion'] }
    case 'redistribution':
      return { confirmation: ['stay-below-range-midpoint', 'weak-rally', 'break-range-low'], invalidation: ['reclaim-range-high', 'long-trend-improves'] }
    case 'markdown':
      return { confirmation: ['stay-below-breakdown', 'lower-high', 'negative-weekly-follow-through'], invalidation: ['reclaim-range', 'failed-downside-test'] }
    default:
      return { confirmation: ['range-event-needs-test', 'wait-for-structural-progress'], invalidation: ['new-range-invalidates-reading'] }
  }
}

export function analyzeWyckoffStructure(input: {
  dailyBars: OhlcvBar[]
  metrics: MarketMonitorMetrics
  trend: MultiTimeframeTrend
  abnormalVolumeRatio: number
}): WyckoffAssessment {
  const bars = sortedBars(input.dailyBars)
  const latest = bars.at(-1)
  const window = bars.slice(-60)
  if (!latest || window.length < 20) {
    return {
      phaseCandidate: 'indeterminate', confidence: 0, testState: 'none', range: null,
      events: [], supportingEvidence: [], opposingEvidence: ['insufficient-range-data'],
      ...phaseConditions('indeterminate'),
    }
  }
  const lower = Math.min(...window.map((bar) => bar.low))
  const upper = Math.max(...window.map((bar) => bar.high))
  const position = upper === lower ? 0.5 : (latest.close - lower) / (upper - lower)
  const widthPercent = lower > 0 ? (upper / lower - 1) * 100 : null
  const events = detectEvents(bars)
  const active = events.filter((event) => event.status !== 'invalidated')
  const spring = active.filter((event) => event.kind === 'spring').at(-1)
  const upthrust = active.filter((event) => event.kind === 'upthrust').at(-1)
  const strength = active.filter((event) => event.kind === 'sign-of-strength' || event.kind === 'last-point-of-support').at(-1)
  const weakness = active.filter((event) => event.kind === 'sign-of-weakness' || event.kind === 'last-point-of-supply').at(-1)
  const highEffortSmallResult = (input.metrics.volumeRatio20d ?? 0) >= input.abnormalVolumeRatio
    && Math.abs(input.metrics.change1dPercent ?? 0) < 0.6

  let phaseCandidate: WyckoffPhaseCandidate = 'indeterminate'
  if (strength?.status === 'confirmed' || (strength && input.trend.medium.direction === 'bullish')) phaseCandidate = 'markup'
  else if (weakness?.status === 'confirmed' || (weakness && input.trend.medium.direction === 'bearish')) phaseCandidate = 'markdown'
  else if ((spring || highEffortSmallResult) && position <= 0.4) phaseCandidate = 'accumulation'
  else if ((upthrust || highEffortSmallResult) && position >= 0.6) phaseCandidate = 'distribution'
  else if (input.trend.long.direction === 'bullish' && input.trend.medium.regime !== 'trend') phaseCandidate = 'reaccumulation'
  else if (input.trend.long.direction === 'bearish' && input.trend.medium.regime !== 'trend') phaseCandidate = 'redistribution'

  const normalizedEvents = events.map((event) => event.kind === 'upthrust' && phaseCandidate === 'distribution'
    ? { ...event, kind: 'upthrust-after-distribution' as const }
    : event)
  const latestEvent = normalizedEvents.at(-1)
  const testState: WyckoffTestState = !latestEvent ? 'none'
    : latestEvent.status === 'confirmed' ? 'confirmed'
      : latestEvent.status === 'invalidated' ? 'invalidated' : 'pending'
  const supportingEvidence: string[] = []
  const opposingEvidence: string[] = []
  if (position <= 0.35) supportingEvidence.push('range-low-location')
  if (position >= 0.65) supportingEvidence.push('range-high-location')
  if (highEffortSmallResult) supportingEvidence.push('high-effort-small-result')
  if (spring) supportingEvidence.push('spring-reclaim')
  if (upthrust) supportingEvidence.push('upthrust-rejection')
  if (strength) supportingEvidence.push('sign-of-strength')
  if (weakness) supportingEvidence.push('sign-of-weakness')
  if (latestEvent?.status === 'confirmed') supportingEvidence.push('successful-test')
  if (input.trend.long.direction === 'bullish' && ['accumulation', 'markdown', 'redistribution'].includes(phaseCandidate)) opposingEvidence.push('long-trend-bullish')
  if (input.trend.long.direction === 'bearish' && ['distribution', 'markup', 'reaccumulation'].includes(phaseCandidate)) opposingEvidence.push('long-trend-bearish')
  if (!normalizedEvents.length) opposingEvidence.push('no-defining-event')
  if (!highEffortSmallResult) opposingEvidence.push('no-absorption-evidence')
  const eventConfidence = latestEvent?.status === 'confirmed' ? 20 : latestEvent?.status === 'candidate' ? 10 : 0
  const confidence = phaseCandidate === 'indeterminate'
    ? Math.min(55, 30 + supportingEvidence.length * 5)
    : Math.min(85, 45 + eventConfidence + supportingEvidence.length * 5 - opposingEvidence.length * 5)
  return {
    phaseCandidate,
    confidence: Math.max(0, confidence),
    testState,
    range: { lookback: window.length, lower: rounded(lower, 6), upper: rounded(upper, 6), position: rounded(position, 4), widthPercent: widthPercent == null ? null : rounded(widthPercent) },
    events: normalizedEvents,
    supportingEvidence,
    opposingEvidence,
    ...phaseConditions(phaseCandidate),
  }
}
