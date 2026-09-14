import { describe, expect, it } from 'vitest'
import type { OhlcvBar } from '../market-data/bars/index.js'
import { analyzeEvidence } from './analysis.js'

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
