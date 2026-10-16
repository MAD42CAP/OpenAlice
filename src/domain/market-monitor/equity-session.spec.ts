import { describe, expect, it } from 'vitest'
import type { OhlcvBar } from '../market-data/bars/index.js'
import { isCurrentEquityHourlyEvidence, regularEquitySession, selectAnalysisHourlyBars, upcomingEquitySessionEnd } from './equity-session.js'

const bar = (date: string, close = 100, volume: number | null = 1000): OhlcvBar => ({ date, open: close, high: close + 1, low: close - 1, close, volume })
const history = (hours = [14, 15, 16, 17, 18, 19]) => ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']
  .flatMap(day => hours.map((hour, i) => bar(`${day}T${hour}:00:00Z`, 100 + i)))
const at = new Date('2026-10-16T01:00:00Z')

describe('published US equity sessions', () => {
  it('distinguishes normal sessions, holidays, early closes, weekends and unknown years', () => {
    expect(regularEquitySession('2026-10-15')).toMatchObject({ known: true, trading: true, openMinutes: 570, closeMinutes: 960 })
    expect(regularEquitySession('2026-11-26')).toMatchObject({ known: true, trading: false })
    expect(regularEquitySession('2026-11-27')).toMatchObject({ known: true, trading: true, closeMinutes: 780 })
    expect(regularEquitySession('2026-12-24').closeMinutes).toBe(780)
    expect(regularEquitySession('2027-12-24').trading).toBe(false)
    expect(regularEquitySession('2028-07-03').closeMinutes).toBe(780)
    expect(regularEquitySession('2028-01-03').trading).toBe(true)
    expect(regularEquitySession('2026-10-17').trading).toBe(false)
    expect(regularEquitySession('2029-01-02')).toMatchObject({ known: false, trading: false })
    expect(regularEquitySession('2026-02-30').known).toBe(false)
  })
})

describe('equity analysis hourly policy', () => {
  it('keeps a sharp sparse post-close trade out of prices, momentum and volume without altering raw bars', () => {
    const input = history()
    Object.assign(input.at(-1)!, { close: 151.28, high: 152 })
    input.push(bar('2026-10-15T20:00:00Z', 145.8, 549))
    const raw = structuredClone(input)
    const selected = selectAnalysisHourlyBars(input, 'MSTR', at)
    expect(selected.lastClose).toBe(151.28)
    expect(selected.pulse).toMatchObject({ available: true, latestAt: '2026-10-15T19:00:00Z', volumeRatio: 1 })
    expect(selected.bars.some(row => row.date === '2026-10-15T20:00:00Z')).toBe(false)
    expect(input).toEqual(raw)
  })

  it.each([
    ['summer', '2026-10-15T13:00:00Z', '2026-10-15T20:00:00Z'],
    ['winter', '2026-01-15T14:00:00Z', '2026-01-15T21:00:00Z'],
  ])('excludes partial opening and extended-hours buckets using New York DST (%s)', (_season, opening, closing) => {
    const selected = selectAnalysisHourlyBars([bar(opening), bar(closing)], 'TSLA', at)
    expect(selected.excluded.session).toBe(2)
    expect(selected.latestEligibleAt).toBe(null)
  })

  it('accepts full 09:30 buckets but excludes a 15:30 bucket crossing the close', () => {
    const input = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].flatMap(day => [bar(`${day}T13:30:00Z`), bar(`${day}T14:30:00Z`)])
    input.push(bar('2026-10-15T19:30:00Z', 70))
    const result = selectAnalysisHourlyBars(input, 'TSLA', new Date('2026-10-15T15:30:00Z'))
    expect(result.pulse).toMatchObject({ available: true, latestAt: '2026-10-15T14:30:00Z', latestChangePercent: 0 })
    expect(result.excluded.session).toBe(1)
  })

  it('excludes an hour still forming and refuses overnight/weekend momentum', () => {
    const selected = selectAnalysisHourlyBars(history(), 'TSLA', new Date('2026-10-15T19:30:00Z'))
    expect(selected.excluded.unfinished).toBe(1)
    expect(selected.pulse.latestAt).toBe('2026-10-15T18:00:00Z')
    const morningOnly = selectAnalysisHourlyBars(history([14]), 'TSLA', at)
    expect(morningOnly.pulse).toMatchObject({ available: false, latestChangePercent: null, fourHourChangePercent: null })
  })

  it('removes holiday/weekend rows and uses the early close for bucket containment', () => {
    const input = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-27'].map(day => bar(`${day}T17:00:00Z`))
    input.push(bar('2026-11-26T17:00:00Z'), bar('2026-11-28T17:00:00Z'), bar('2026-11-27T17:30:00Z'), bar('2026-11-27T18:00:00Z'))
    const selected = selectAnalysisHourlyBars(input, 'MSTR', new Date('2026-11-28T00:00:00Z'))
    expect(selected.latestEligibleAt).toBe('2026-11-27T17:00:00Z')
    expect(selected.excluded.session).toBe(4)
  })

  it.each([0, null, 1, 99])('treats sparse or missing latest volume (%s) as missing confirmation rather than a down move', volume => {
    const input = history()
    Object.assign(input.at(-1)!, { close: 50, low: 49, volume })
    const selected = selectAnalysisHourlyBars(input, 'MSTR', at)
    expect(selected.pulse).toMatchObject({ available: false, latestAt: '2026-10-15T19:00:00Z', latestChangePercent: null, fourHourChangePercent: null, volumeRatio: null, abnormal: false })
    expect(selected.continuousBars).toEqual([])
    expect(selected.lastClose).toBe(null)
  })

  it('does not bridge a sparse internal bucket and compares volume only with the same local slot', () => {
    const input = history()
    input.find(row => row.date === '2026-10-15T17:00:00Z')!.volume = 1
    input.filter(row => row.date.includes('T14:')).forEach(row => { row.volume = 100000 })
    const selected = selectAnalysisHourlyBars(input, 'MSTR', at)
    expect(selected.pulse).toMatchObject({ available: true, latestChangePercent: 0.96, fourHourChangePercent: null, volumeRatio: 1 })
    expect(selected.continuousBars).toHaveLength(2)
  })

  it('does not use fresh premarket data to certify stale regular-session evidence', () => {
    const input = [...history(), bar('2026-10-16T13:00:00Z', 40)]
    const selected = selectAnalysisHourlyBars(input, 'MSTR', new Date('2026-10-16T15:00:00Z'))
    expect(selected.pulse.available).toBe(false)
    expect(selected.bars).toEqual([])
    expect(selected.lastClose).toBe(null)
    expect(selected.note).toContain('regular-session evidence is stale')
  })

  it('breaks continuity on malformed OHLC instead of treating it as a directional print', () => {
    const input = history()
    input.at(-1)!.close = 200
    const selected = selectAnalysisHourlyBars(input, 'TSLA', at)
    expect(selected.pulse.available).toBe(false)
    expect(selected.continuousBars).toEqual([])
  })

  it('requires past-only volume coverage and fails closed outside the finite calendar', () => {
    expect(selectAnalysisHourlyBars(history().slice(0, 6), 'TSLA', at).pulse.available).toBe(false)
    const selected = selectAnalysisHourlyBars([bar('2029-01-02T16:00:00Z'), bar('2029-01-02T17:00:00Z')], 'TSLA', new Date('2029-01-03T00:00:00Z'))
    expect(selected.bars).toEqual([])
    expect(selected.note).toContain('calendar unavailable outside published 2026–2028')
  })

  it('keeps completed BTC weekend and post-equity-close hours with their original numeric pulse', () => {
    const rows = Array.from({ length: 6 }, (_, i) => bar(`2026-10-17T${18 + i}:00:00Z`, 100 + i))
    rows.push(bar('2026-10-18T00:00:00Z', 200))
    const selected = selectAnalysisHourlyBars(rows, 'BTC', new Date('2026-10-18T00:00:00Z'))
    expect(selected.bars).toEqual(rows.slice(0, 6))
    expect(selected.pulse).toMatchObject({ available: true, latestChangePercent: 0.96, fourHourChangePercent: 3.96, volumeRatio: 1 })
  })
})


describe('current equity hourly evidence and event windows', () => {
  it('counts future official sessions across holidays and refuses unknown coverage', () => {
    expect(upcomingEquitySessionEnd('2026-10-15')).toBe('2026-10-22')
    expect(upcomingEquitySessionEnd('2026-11-25')).toBe('2026-12-03')
    expect(upcomingEquitySessionEnd('2026-12-24', 1)).toBe('2026-12-28')
    expect(upcomingEquitySessionEnd('2028-12-28')).toBeNull()
    expect(upcomingEquitySessionEnd('2029-01-02')).toBeNull()
    expect(upcomingEquitySessionEnd('2026-10-15', 0)).toBeNull()
  })

  it('allows the most recent completed close before the open, then waits for this session’s first full hour', () => {
    const prior = '2026-10-15T19:00:00Z'
    expect(isCurrentEquityHourlyEvidence(prior, new Date('2026-10-16T13:29:59Z'))).toBe(true)
    expect(isCurrentEquityHourlyEvidence(prior, new Date('2026-10-16T13:30:00Z'))).toBe(false)
    expect(isCurrentEquityHourlyEvidence('2026-10-16T13:30:00Z', new Date('2026-10-16T14:29:59Z'))).toBe(false)
    expect(isCurrentEquityHourlyEvidence('2026-10-16T13:30:00Z', new Date('2026-10-16T14:30:00Z'))).toBe(true)
    expect(isCurrentEquityHourlyEvidence('2026-10-16T14:00:00Z', new Date('2026-10-16T15:00:00Z'))).toBe(true)
  })

  it('expires frozen intraday evidence after three hours and requires the final full bucket at the close', () => {
    expect(isCurrentEquityHourlyEvidence('2026-10-15T14:00:00Z', new Date('2026-10-15T17:00:00Z'))).toBe(true)
    expect(isCurrentEquityHourlyEvidence('2026-10-15T14:00:00Z', new Date('2026-10-15T17:00:01Z'))).toBe(false)
    expect(isCurrentEquityHourlyEvidence('2026-10-15T18:00:00Z', new Date('2026-10-15T20:00:00Z'))).toBe(false)
    expect(isCurrentEquityHourlyEvidence('2026-10-15T19:00:00Z', new Date('2026-10-15T20:00:00Z'))).toBe(true)
    expect(isCurrentEquityHourlyEvidence('2026-10-15T18:30:00Z', new Date('2026-10-15T20:00:00Z'))).toBe(true)
  })

  it('uses the early close across Christmas closure/weekend and refuses a superseded session', () => {
    expect(isCurrentEquityHourlyEvidence('2026-12-24T17:00:00Z', new Date('2026-12-28T14:00:00Z'))).toBe(true)
    expect(isCurrentEquityHourlyEvidence('2026-12-24T16:30:00Z', new Date('2026-12-28T14:00:00Z'))).toBe(true)
    expect(isCurrentEquityHourlyEvidence('2026-12-24T18:00:00Z', new Date('2026-12-28T14:00:00Z'))).toBe(false)
    expect(isCurrentEquityHourlyEvidence('2026-12-24T17:00:00Z', new Date('2026-12-28T14:30:00Z'))).toBe(false)
    expect(isCurrentEquityHourlyEvidence('2026-10-09T19:00:00Z', new Date('2026-10-13T12:00:00Z'))).toBe(false)
    expect(isCurrentEquityHourlyEvidence('2026-10-12T19:00:00Z', new Date('2026-10-13T12:00:00Z'))).toBe(true)
    expect(isCurrentEquityHourlyEvidence('2026-09-04T19:00:00Z', new Date('2026-09-07T17:00:00Z'))).toBe(true)
  })

  it('rejects partial, after-hours, weekend, future and unsupported-year timestamps', () => {
    const now = new Date('2026-10-16T17:00:00Z')
    expect(isCurrentEquityHourlyEvidence('2026-10-16T13:00:00Z', now)).toBe(false)
    expect(isCurrentEquityHourlyEvidence('2026-10-15T20:00:00Z', now)).toBe(false)
    expect(isCurrentEquityHourlyEvidence('2026-10-17T14:00:00Z', new Date('2026-10-18T00:00:00Z'))).toBe(false)
    expect(isCurrentEquityHourlyEvidence('2026-10-16T17:00:00Z', now)).toBe(false)
    expect(isCurrentEquityHourlyEvidence('2029-01-02T16:00:00Z', new Date('2029-01-02T17:00:00Z'))).toBe(false)
  })
})
