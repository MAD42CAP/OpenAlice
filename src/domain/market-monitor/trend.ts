import type { OhlcvBar } from '../market-data/bars/index.js'
import type {
  EvidenceTone,
  MarketMonitorAsset,
  MarketMonitorMetrics,
  MultiTimeframeTrend,
  TrendAssessment,
  TrendDirection,
  TrendHorizon,
  TrendSignal,
} from './types.js'

const pct = (latest: number, prior: number): number | null =>
  Number.isFinite(latest) && Number.isFinite(prior) && prior !== 0
    ? ((latest / prior) - 1) * 100
    : null

const rounded = (value: number | null, digits = 2): number | null =>
  value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits))

function sortedBars(bars: OhlcvBar[]): OhlcvBar[] {
  return bars
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function smaAt(bars: OhlcvBar[], length: number, endOffset = 0): number | null {
  const end = bars.length - endOffset
  if (end < length) return null
  return mean(bars.slice(end - length, end).map((bar) => bar.close))
}

function tone(value: number | null, positive: number, negative = -positive): EvidenceTone {
  if (value == null) return 'neutral'
  return value >= positive ? 'positive' : value <= negative ? 'negative' : 'neutral'
}

function signal(id: string, signalTone: EvidenceTone, weight: number, value?: number | null): TrendSignal {
  return { id, tone: signalTone, weight, ...(value !== undefined ? { value: rounded(value) } : {}) }
}

function assess(horizon: TrendHorizon, signals: TrendSignal[], minimumDirectionalScore = 22): TrendAssessment {
  const usable = signals.filter((item) => item.value !== null)
  if (usable.length < 2) {
    return { horizon, direction: 'insufficient', regime: 'unknown', score: 0, confidence: 0, signals }
  }
  const totalWeight = usable.reduce((sum, item) => sum + item.weight, 0)
  const signed = usable.reduce((sum, item) => sum + (item.tone === 'positive' ? item.weight : item.tone === 'negative' ? -item.weight : 0), 0)
  const score = totalWeight ? Math.round(signed / totalWeight * 100) : 0
  const positive = usable.some((item) => item.tone === 'positive')
  const negative = usable.some((item) => item.tone === 'negative')
  let direction: TrendDirection
  if (score >= minimumDirectionalScore) direction = 'bullish'
  else if (score <= -minimumDirectionalScore) direction = 'bearish'
  else if (positive && negative) direction = 'transition'
  else direction = 'sideways'
  const regime = direction === 'bullish' || direction === 'bearish'
    ? (Math.abs(score) >= 45 ? 'trend' : 'transition')
    : direction === 'sideways' ? 'range' : 'transition'
  const confidence = Math.min(88, Math.round(50 + Math.abs(score) * 0.38))
  return { horizon, direction, regime, score, confidence, signals }
}

function shortTerm(daily: OhlcvBar[], metrics: MarketMonitorMetrics): TrendAssessment {
  const latest = daily.at(-1)
  const priorFive = daily.slice(-6, -1)
  const fiveBreak = latest && priorFive.length >= 5
    ? latest.close > Math.max(...priorFive.map((bar) => bar.high)) ? 1
      : latest.close < Math.min(...priorFive.map((bar) => bar.low)) ? -1 : 0
    : null
  return assess('short', [
    signal('short-hour-momentum', tone(metrics.intraday.latestChangePercent, 0.25), 1, metrics.intraday.latestChangePercent),
    signal('short-four-hour-momentum', tone(metrics.intraday.fourHourChangePercent, 0.8), 2, metrics.intraday.fourHourChangePercent),
    signal('short-one-day-momentum', tone(metrics.change1dPercent, 0.6), 2, metrics.change1dPercent),
    signal('short-five-day-momentum', tone(metrics.change5dPercent, 1.5), 2, metrics.change5dPercent),
    signal('short-five-day-structure', fiveBreak == null ? 'neutral' : fiveBreak > 0 ? 'positive' : fiveBreak < 0 ? 'negative' : 'neutral', 2, fiveBreak),
    signal('short-hour-volume', metrics.intraday.volumeRatio == null || metrics.intraday.volumeRatio < 1.8
      ? 'neutral'
      : (metrics.intraday.latestChangePercent ?? 0) > 0 ? 'positive' : (metrics.intraday.latestChangePercent ?? 0) < 0 ? 'negative' : 'neutral', 1, metrics.intraday.volumeRatio),
  ])
}

function mediumTerm(daily: OhlcvBar[], metrics: MarketMonitorMetrics, abnormalVolumeRatio: number): TrendAssessment {
  const latest = daily.at(-1)!
  const prior20 = daily.slice(-21, -1)
  const structure = prior20.length >= 20
    ? latest.close > Math.max(...prior20.map((bar) => bar.high)) ? 1
      : latest.close < Math.min(...prior20.map((bar) => bar.low)) ? -1 : 0
    : null
  const current20 = smaAt(daily, 20)
  const previous20 = smaAt(daily, 20, 10)
  const slope = current20 != null && previous20 != null ? pct(current20, previous20) : null
  const highEffort = (metrics.volumeRatio20d ?? 0) >= abnormalVolumeRatio
  const mutedResult = Math.abs(metrics.change1dPercent ?? 0) < 0.6
  const effortTone = highEffort && mutedResult ? 'neutral' : tone(metrics.change1dPercent, 0.6)
  return assess('medium', [
    signal('medium-twenty-day-structure', structure == null ? 'neutral' : structure > 0 ? 'positive' : structure < 0 ? 'negative' : 'neutral', 3, structure),
    signal('medium-sixty-day-location', metrics.rangePosition60d == null ? 'neutral' : metrics.rangePosition60d >= 0.72 ? 'positive' : metrics.rangePosition60d <= 0.28 ? 'negative' : 'neutral', 2, metrics.rangePosition60d),
    signal('medium-weekly-follow-through', tone(metrics.weeklyChangePercent, 1), 2, metrics.weeklyChangePercent),
    signal('medium-volume-result', effortTone, highEffort ? 3 : 1, metrics.volumeRatio20d),
    signal('medium-twenty-day-slope', tone(slope, 1), 2, slope),
  ])
}

function longTerm(asset: MarketMonitorAsset, daily: OhlcvBar[]): TrendAssessment {
  const latest = daily.at(-1)
  const ma50 = smaAt(daily, 50)
  const ma200 = smaAt(daily, 200)
  const priorMa200 = smaAt(daily, 200, 20)
  const priceVs200 = latest && ma200 ? pct(latest.close, ma200) : null
  const cross = ma50 && ma200 ? pct(ma50, ma200) : null
  const slope = ma200 && priorMa200 ? pct(ma200, priorMa200) : null
  const return120 = daily.length >= 121 && latest ? pct(latest.close, daily.at(-121)!.close) : null
  const rangeLookback = asset === 'BTC' ? 365 : 252
  const window = daily.slice(-rangeLookback)
  const position = latest && window.length >= 200
    ? (() => {
        const low = Math.min(...window.map((bar) => bar.low))
        const high = Math.max(...window.map((bar) => bar.high))
        return high === low ? 0.5 : (latest.close - low) / (high - low)
      })()
    : null
  return assess('long', [
    signal('long-price-vs-two-hundred-day', tone(priceVs200, 2), 3, priceVs200),
    signal('long-fifty-vs-two-hundred-day', tone(cross, 1), 3, cross),
    signal('long-two-hundred-day-slope', tone(slope, 0.5), 2, slope),
    signal('long-one-hundred-twenty-day-return', tone(return120, 8), 2, return120),
    signal('long-annual-range-location', position == null ? 'neutral' : position >= 0.7 ? 'positive' : position <= 0.3 ? 'negative' : 'neutral', 2, position),
  ])
}

export function analyzeMultiTimeframeTrend(input: {
  asset: MarketMonitorAsset
  dailyBars: OhlcvBar[]
  intradayBars: OhlcvBar[]
  metrics: MarketMonitorMetrics
  abnormalVolumeRatio: number
}): MultiTimeframeTrend {
  const daily = sortedBars(input.dailyBars)
  const short = shortTerm(daily, input.metrics)
  const medium = mediumTerm(daily, input.metrics, input.abnormalVolumeRatio)
  const long = longTerm(input.asset, daily)
  const directional = [short.direction, medium.direction, long.direction]
    .filter((direction) => direction === 'bullish' || direction === 'bearish')
  const bullish = directional.filter((direction) => direction === 'bullish').length
  const bearish = directional.filter((direction) => direction === 'bearish').length
  const available = [short, medium, long].filter((item) => item.direction !== 'insufficient')
  const alignment = available.length < 2 ? 'insufficient'
    : bullish >= 2 && bearish === 0 ? 'aligned-bullish'
      : bearish >= 2 && bullish === 0 ? 'aligned-bearish'
        : available.every((item) => item.direction === 'sideways') ? 'range'
          : 'mixed'
  return { short, medium, long, alignment }
}
