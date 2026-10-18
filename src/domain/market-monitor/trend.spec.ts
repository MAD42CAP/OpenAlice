import { describe, expect, it } from 'vitest'
import type { OhlcvBar } from '../market-data/bars/index.js'
import { analyzeEvidence } from './analysis.js'
import { regularEquitySession } from './equity-session.js'
import { EQUITY_MEDIUM_POLICY, analyzeMultiTimeframeTrend } from './trend.js'

function trendSeries(count: number, stepMs: number, direction: 1 | -1, magnitude = 1): OhlcvBar[] {
  const start = Date.parse('2025-01-01T00:00:00Z')
  return Array.from({ length: count }, (_, index) => {
    const close = 500 + direction * index * magnitude
    return {
      date: new Date(start + index * stepMs).toISOString(),
      open: close - direction * 0.4,
      high: close + 0.35,
      low: close - 0.35,
      close,
      volume: 1_000 + index,
    }
  })
}

describe('multi-timeframe trend analysis', () => {
  it('keeps an aligned long history separate across all three horizons', () => {
    const result = analyzeEvidence({
      asset: 'BTC',
      dailyBars: trendSeries(400, 86_400_000, 1),
      intradayBars: trendSeries(48, 3_600_000, 1, 3),
      abnormalVolumeRatio: 1.8,
      abnormalMovePercent: 1.5,
    })
    expect(result.trend).toMatchObject({
      alignment: 'aligned-bullish',
      short: { direction: 'bullish' },
      medium: { direction: 'bullish' },
      long: { direction: 'bullish' },
    })
    expect(result.dailyBrief).toMatchObject({
      cadence: 'daily-bar',
      periodKey: result.metrics.lastBarAt.slice(0, 10),
      overallDirection: 'bullish',
      headline: 'aligned-bullish',
    })
  })

  it('reports mixed horizons instead of averaging away a short-term reversal', () => {
    const daily = trendSeries(400, 86_400_000, 1)
    const anchor = daily.at(-6)!.close
    daily.splice(-5, 5, ...daily.slice(-5).map((row, index) => ({
      ...row,
      open: anchor - index * 0.5,
      high: anchor + 0.3 - index * 0.5,
      low: anchor - 0.8 - index * 0.5,
      close: anchor - 0.5 - index * 0.5,
    })))
    const result = analyzeEvidence({
      asset: 'TSLA',
      dailyBars: daily,
      intradayBars: trendSeries(48, 3_600_000, -1, 3),
      abnormalVolumeRatio: 1.8,
      abnormalMovePercent: 1.5,
    })
    expect(result.trend.short.direction).toBe('bearish')
    expect(result.trend.medium.direction).toBe('bullish')
    expect(result.trend.long.direction).toBe('bullish')
    expect(result.trend.alignment).toBe('mixed')
    expect(result.dailyBrief).toMatchObject({ overallDirection: 'transition', headline: 'mixed' })
    expect(result.dailyBrief.risks).toContain('mixed-timeframes')
  })

  it('marks the long horizon insufficient when a 200-day structure cannot be calculated', () => {
    const result = analyzeEvidence({
      asset: 'BTC',
      dailyBars: trendSeries(90, 86_400_000, 1),
      intradayBars: [],
      abnormalVolumeRatio: 1.8,
      abnormalMovePercent: 1.5,
    })
    expect(result.trend.long).toMatchObject({ direction: 'insufficient', regime: 'unknown', confidence: 0 })
    expect(result.dailyBrief.risks).toContain('intraday-unavailable')
  })
})

function equitySeries(closes: number[], end = '2026-10-16'): OhlcvBar[] {
  const days: string[] = []
  for (let time = Date.parse(end); days.length < closes.length; time -= 86_400_000) {
    const day = new Date(time).toISOString().slice(0, 10)
    if (regularEquitySession(day).trading) days.unshift(day)
  }
  return closes.map((close, index) => ({ date: days[index]!, open: close, high: close + 1, low: close - 1, close, volume: 1000 }))
}

const risingCloses = () => Array.from({ length: 120 }, (_, index) => 100 + index * 2)
function weakeningSeries() {
  const closes = risingCloses()
  closes.splice(-10, 10, 332, 334, 336, 338, 340, 328, 322, 316, 310, 304)
  return equitySeries(closes)
}

function equityInput(dailyBars = weakeningSeries(), asset: 'TSLA' | 'MSTR' | 'BTC' = 'MSTR') {
  return { asset, asOf: new Date('2026-10-17T00:00:00Z'), dailyBars, intradayBars: [], abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5 }
}

describe('prospective equity medium weakening guard', () => {
  it.each(['TSLA', 'MSTR'] as const)('withholds stale bullish %s context after persistent completed-session weakness', asset => {
    const input = equityInput(weakeningSeries(), asset), saved = structuredClone(input)
    const legacy = analyzeEvidence(input)
    const current = analyzeEvidence(input, undefined, EQUITY_MEDIUM_POLICY)
    expect(legacy.metrics.weeklyChangePercent).toBeGreaterThan(0)
    expect(legacy.trend.medium.signals.find(s => s.id === 'medium-twenty-day-slope')?.tone).toBe('positive')
    expect(legacy.trend.medium.direction).toBe('bullish')
    expect(current.trend.medium).toMatchObject({ direction: 'transition', regime: 'transition', score: legacy.trend.medium.score,
      confidence: legacy.trend.medium.confidence, signals: legacy.trend.medium.signals,
      guard: { policy: EQUITY_MEDIUM_POLICY, status: 'weakening', applied: true, backgroundDirection: 'bullish', observedSessions: 30,
        belowAverageSessions: 3, latestBelowAverage: true, recentAverage: 316, previousAverage: 336 } })
    expect(current.trend.short).toEqual(legacy.trend.short)
    expect(current.trend.long).toEqual(legacy.trend.long)
    expect(input).toEqual(saved)
  })

  it('does not let a high 60-session location outvote current deterioration', () => {
    const input = equityInput(), legacy = analyzeEvidence(input)
    const metrics = { ...legacy.metrics, rangePosition60d: 0.85 }
    const base = { ...input, metrics, mediumPolicy: EQUITY_MEDIUM_POLICY }
    const result = analyzeMultiTimeframeTrend(base)
    expect(result.medium.signals.find(s => s.id === 'medium-sixty-day-location')?.tone).toBe('positive')
    expect(result.medium.guard).toMatchObject({ backgroundDirection: 'bullish', applied: true })
    expect(result.medium.direction).toBe('transition')
  })

  it('keeps a single deep pullback separate from persistent medium weakness', () => {
    const closes = risingCloses(); closes[closes.length - 1] = 304
    const input = equityInput(equitySeries(closes))
    const legacy = analyzeEvidence(input), current = analyzeEvidence(input, undefined, EQUITY_MEDIUM_POLICY)
    expect(current.trend.medium.guard).toMatchObject({ status: 'clear', applied: false, belowAverageSessions: 1 })
    expect(current.trend.medium.direction).toBe(legacy.trend.medium.direction)
    expect(current.trend.medium.direction).not.toBe('bearish')
  })

  it('keeps a bounce below the 20-session mean from erasing persistent weakness', () => {
    const bars = weakeningSeries()
    Object.assign(bars.at(-2)!, { open: 300, high: 301, low: 299, close: 300 })
    Object.assign(bars.at(-1)!, { open: 310, high: 311, low: 309, close: 310 })
    const result = analyzeEvidence(equityInput(bars), undefined, EQUITY_MEDIUM_POLICY)
    expect(result.metrics.change1dPercent).toBeGreaterThan(0)
    expect(result.trend.medium).toMatchObject({ direction: 'transition', guard: { status: 'weakening', applied: true } })
  })

  it('releases the veto when the newest completed close reclaims the average', () => {
    const bars = weakeningSeries()
    Object.assign(bars.at(-1)!, { open: 350, high: 351, low: 349, close: 350 })
    const input = equityInput(bars), legacy = analyzeEvidence(input)
    const result = analyzeEvidence(input, undefined, EQUITY_MEDIUM_POLICY)
    expect(result.trend.medium.guard).toMatchObject({ status: 'clear', applied: false, latestBelowAverage: false })
    expect(result.trend.medium.direction).toBe(legacy.trend.medium.direction)
  })

  it('does not veto an established rise or interpret equality as deterioration', () => {
    for (const closes of [risingCloses(), Array.from({ length: 120 }, () => 100)]) {
      const input = equityInput(equitySeries(closes)), legacy = analyzeEvidence(input)
      const result = analyzeEvidence(input, undefined, EQUITY_MEDIUM_POLICY)
      expect(result.trend.medium.guard).toMatchObject({ status: 'clear', applied: false, belowAverageSessions: 0, latestBelowAverage: false })
      expect(result.trend.medium.direction).toBe(legacy.trend.medium.direction)
    }
  })

  it('preserves an already bearish background rather than assigning another bearish vote', () => {
    const input = equityInput(equitySeries(risingCloses().reverse()))
    const legacy = analyzeEvidence(input), current = analyzeEvidence(input, undefined, EQUITY_MEDIUM_POLICY)
    expect(legacy.trend.medium.direction).toBe('bearish')
    expect(current.trend.medium).toMatchObject({ direction: 'bearish', score: legacy.trend.medium.score,
      guard: { status: 'weakening', applied: false, backgroundDirection: 'bearish' } })
  })

  it.each([
    ['short history', (bars: OhlcvBar[]) => bars.slice(-29), 'insufficient-daily-history'],
    ['duplicate session', (bars: OhlcvBar[]) => [...bars, { ...bars.at(-1)! }], 'invalid-daily-bars'],
    ['invalid OHLC', (bars: OhlcvBar[]) => bars.map((bar, index) => index === bars.length - 1 ? { ...bar, high: bar.close - 1 } : bar), 'invalid-daily-bars'],
    ['missing scheduled session', (bars: OhlcvBar[]) => bars.filter((_, index) => index !== bars.length - 4), 'missing-daily-sessions'],
    ['missing latest completed session', (bars: OhlcvBar[]) => bars.slice(0, -1), 'missing-daily-sessions'],
  ] as const)('withholds medium direction for %s rather than manufacturing bearish evidence', (_name, change, reason) => {
    const result = analyzeEvidence(equityInput(change(weakeningSeries())), undefined, EQUITY_MEDIUM_POLICY)
    expect(result.trend.medium).toMatchObject({ direction: 'insufficient', regime: 'unknown', confidence: 0,
      guard: { status: 'unavailable', applied: true, belowAverageSessions: null } })
    expect(result.trend.medium.guard?.reasons).toContain(reason)
  })

  it('does not revive older prices after a non-finite current session is filtered from numerical metrics', () => {
    const bars = weakeningSeries(); bars.at(-1)!.close = NaN
    const result = analyzeEvidence(equityInput(bars), undefined, EQUITY_MEDIUM_POLICY)
    expect(result.trend.medium.direction).toBe('insufficient')
    expect(result.trend.medium.guard?.reasons).toContain('invalid-daily-bars')
  })

  it('accepts a completed history across an officially scheduled holiday', () => {
    const bars = equitySeries(risingCloses(), '2026-07-08')
    const result = analyzeEvidence({ ...equityInput(bars), asOf: new Date('2026-07-09T00:00:00Z') }, undefined, EQUITY_MEDIUM_POLICY)
    expect(bars.some(bar => bar.date === '2026-07-03')).toBe(false)
    expect(result.trend.medium.guard).toMatchObject({ status: 'clear', applied: false, reasons: [] })
  })

  it('ignores forming and future daily prices at the existing 16:15 New York cutoff', () => {
    const bars = weakeningSeries(), input = { ...equityInput(bars), asOf: new Date('2026-10-16T20:14:00Z') }
    const forming = analyzeEvidence(input, undefined, EQUITY_MEDIUM_POLICY)
    const without = analyzeEvidence({ ...input, dailyBars: bars.slice(0, -1) }, undefined, EQUITY_MEDIUM_POLICY)
    expect(forming).toEqual(without)
    const future = { date: '2026-10-19', open: 1, high: 2, low: 0.5, close: 1, volume: 1000 }
    expect(analyzeEvidence({ ...input, dailyBars: [...bars, future] }, undefined, EQUITY_MEDIUM_POLICY)).toEqual(without)
    expect(forming.metrics.lastBarAt).toBe('2026-10-15')
    expect(analyzeEvidence({ ...input, asOf: new Date('2026-10-16T20:15:00Z') }, undefined, EQUITY_MEDIUM_POLICY).metrics.lastBarAt).toBe('2026-10-16')
  })

  it('leaves every BTC numerical field unchanged even when the equity policy is explicitly supplied', () => {
    const input = equityInput(weakeningSeries(), 'BTC')
    expect(analyzeEvidence(input, undefined, EQUITY_MEDIUM_POLICY)).toEqual(analyzeEvidence(input))
  })
})
