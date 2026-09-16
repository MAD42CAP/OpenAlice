import { describe, expect, it } from 'vitest'
import type { OhlcvBar } from '../market-data/bars/index.js'
import { analyzeEvidence } from './analysis.js'

function rangeBars(count = 80): OhlcvBar[] {
  const start = Date.parse('2025-01-01T00:00:00Z')
  return Array.from({ length: count }, (_, index) => {
    const close = 104 + Math.sin(index / 2) * 2
    return { date: new Date(start + index * 86_400_000).toISOString(), open: close, high: 111, low: 99, close, volume: 1_000 }
  })
}

function bar(index: number, values: Pick<OhlcvBar, 'open' | 'high' | 'low' | 'close' | 'volume'>): OhlcvBar {
  return { date: new Date(Date.parse('2025-01-01T00:00:00Z') + index * 86_400_000).toISOString(), ...values }
}

const analyze = (dailyBars: OhlcvBar[]) => analyzeEvidence({
  asset: 'BTC', dailyBars, intradayBars: [], abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5,
})

describe('Wyckoff structure analysis', () => {
  it('keeps a spring as a candidate until a quieter secondary test confirms it', () => {
    const base = rangeBars()
    const pending = analyze([...base, bar(80, { open: 100, high: 104, low: 95, close: 100.5, volume: 3_000 })])
    expect(pending.wyckoff.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'spring', status: 'candidate' }),
    ]))
    expect(pending.wyckoff.testState).toBe('pending')

    const confirmed = analyze([...base,
      bar(80, { open: 100, high: 104, low: 95, close: 100.5, volume: 3_000 }),
      bar(81, { open: 100.5, high: 103, low: 99.5, close: 100.2, volume: 800 }),
    ])
    expect(confirmed.wyckoff).toMatchObject({ phaseCandidate: 'accumulation', testState: 'confirmed' })
    expect(confirmed.wyckoff.supportingEvidence).toEqual(expect.arrayContaining(['spring-reclaim', 'successful-test']))
  })

  it('detects a confirmed sign of strength and promotes markup without claiming certainty', () => {
    const base = rangeBars()
    const result = analyze([...base,
      bar(80, { open: 109, high: 113, low: 108, close: 112, volume: 2_000 }),
      bar(81, { open: 112, high: 114, low: 111.5, close: 112.5, volume: 1_200 }),
      bar(82, { open: 112.5, high: 115, low: 112, close: 114, volume: 1_300 }),
    ])
    expect(result.wyckoff.phaseCandidate).toBe('markup')
    expect(result.wyckoff.confidence).toBeLessThanOrEqual(85)
    expect(result.wyckoff.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'sign-of-strength', status: 'confirmed' }),
    ]))
  })

  it('invalidates a spring when a later close breaks its extreme', () => {
    const base = rangeBars()
    const result = analyze([...base,
      bar(80, { open: 100, high: 104, low: 95, close: 100.5, volume: 3_000 }),
      bar(81, { open: 99, high: 100, low: 93, close: 94, volume: 2_500 }),
    ])
    expect(result.wyckoff.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'spring', status: 'invalidated' }),
      expect.objectContaining({ kind: 'sign-of-weakness' }),
    ]))
  })
})

it('requires a quieter LPSY and a later closed follow-through before confirmation', () => {
  const base = [...rangeBars(), bar(80, { open: 100, high: 101, low: 94, close: 96, volume: 3000 })]
  const test = bar(81, { open: 96, high: 99, low: 96, close: 98, volume: 800 })
  const later = bar(82, { open: 98, high: 98, low: 94.5, close: 95, volume: 900 })
  const event = (rows: OhlcvBar[]) => analyze(rows).wyckoff.events.find(row => row.kind === 'last-point-of-supply')
  expect(event([...base, test])?.status).toBe('candidate')
  expect(event([...base, test, later])?.status).toBe('confirmed')
  expect(event([...base, { ...test, volume: 30000 }, later])?.status).toBe('candidate')
  expect(event([...base, { ...test, volume: null }, later])?.status).toBe('candidate')
})

it('does not treat missing spring test volume as quieter volume', () => {
  const result = analyze([...rangeBars(),
    bar(80, { open: 100, high: 104, low: 95, close: 100.5, volume: 3000 }),
    bar(81, { open: 100.5, high: 103, low: 99.5, close: 100.2, volume: null }),
  ])
  expect(result.wyckoff.events.find(row => row.kind === 'spring')?.status).toBe('candidate')
})
