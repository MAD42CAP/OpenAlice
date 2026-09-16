import { describe, expect, it } from 'vitest'
import { assertFreshBars, closedBars } from './bar-policy.js'
import type { OhlcvBar } from '../market-data/bars/index.js'

const bar = (date: string): OhlcvBar => ({ date, open: 100, high: 102, low: 99, close: 101, volume: 1000 })

describe('market monitor bar timing', () => {
  it('excludes the forming UTC day and hour, including at a day boundary', () => {
    const at = new Date('2026-09-16T00:00:00Z')
    expect(closedBars([bar('2026-09-15'), bar('2026-09-16')], 'BTC', '1d', at).map(row => row.date)).toEqual(['2026-09-15'])
    expect(closedBars([bar('2026-09-15T23:00:00Z'), bar('2026-09-16T00:00:00Z')], 'BTC', '1h', at)).toHaveLength(1)
  })

  it.each([['2026-09-16', '20:14', '20:15'], ['2026-01-16', '21:14', '21:15']])('uses New York session close with vendor lag in summer and winter (%s)', (day, before, after) => {
    expect(closedBars([bar(day)], 'TSLA', '1d', new Date(`${day}T${before}:00Z`))).toHaveLength(0)
    expect(closedBars([bar(day)], 'TSLA', '1d', new Date(`${day}T${after}:00Z`))).toHaveLength(1)
  })

  it('rejects stale crypto data on weekends and stale hourly data within the same day', () => {
    expect(() => assertFreshBars([bar('2026-09-11')], 'BTC', '1d', new Date('2026-09-13T12:00:00Z'))).toThrow(/Stale 1d/)
    expect(() => assertFreshBars([bar('2026-09-16T01:00:00Z')], 'BTC', '1h', new Date('2026-09-16T19:00:00Z'))).toThrow(/Stale 1h/)
  })

  it('tolerates an equity weekend but rejects old data during the trading session', () => {
    expect(() => assertFreshBars([bar('2026-09-11T19:00:00Z')], 'TSLA', '1h', new Date('2026-09-13T12:00:00Z'))).not.toThrow()
    expect(() => assertFreshBars([bar('2026-09-15T19:00:00Z')], 'TSLA', '1h', new Date('2026-09-16T17:00:00Z'))).toThrow(/Stale/)
  })
})
