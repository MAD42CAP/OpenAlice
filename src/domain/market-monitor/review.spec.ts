import { describe, expect, it, vi } from 'vitest'
import type { OhlcvBar } from '../market-data/bars/index.js'
import type { MarketMonitorStore } from './store.js'
import type { MarketAiNarration, MarketMonitorSnapshot, MultiTimeframeTrend } from './types.js'
import { buildMarketReview, reviewFeedback, reviewOutcomes, reviewSessionDate, summarizeReview, type ReviewCase } from './review.js'

const trend = Object.fromEntries(['short', 'medium', 'long'].map(horizon => [horizon, { horizon, direction: 'bullish', confidence: 75, signals: [] }])) as unknown as MultiTimeframeTrend
const snapshot = (id = 'first', capturedAt = '2026-09-10T12:00:00Z'): MarketMonitorSnapshot => ({
  id, asset: 'BTC', strategyId: 'evidence-chain-v1', capturedAt, analysisInput: { hash: 'hash', strategyVersion: 2 },
  fingerprint: 'original', analysisBasis: { version: 2, closedBarsOnly: true, dailyAt: '2026-09-09', hourlyAt: null }, trend: { ...trend, alignment: 'mixed' },
  sourceHealth: [{ id: 'daily-bars', provider: 'coinbase' }], evidence: [],
  hypothesis: { bias: 'bearish', summary: 'Original reasoning' },
  wyckoff: { phaseCandidate: 'markdown', range: { lower: 98, upper: 105 }, confirmation: ['stay-below-breakdown'] },
} as unknown as MarketMonitorSnapshot)
function sample(): ReviewCase {
  return { id: 'first', kind: 'rules', snapshotId: 'first', issuedAt: '2026-09-10T12:00:00Z', sessionDate: '2026-09-10', strategyVersion: 2,
    archiveStatus: 'verified', original: snapshot(), narration: null, originalProvider: 'coinbase', outcomeProvider: 'coinbase', providerChanged: false, path: [], outcomes: [] }
}
function bars(days = 9): OhlcvBar[] {
  return Array.from({ length: days }, (_, i) => ({ date: `2026-09-${String(10 + i).padStart(2, '0')}`, open: 100, high: 112, low: 95, close: 108 + i, volume: 100 })).map(bar => ({ ...bar, high: Math.max(bar.high, bar.close) }))
}
function store(rows = [snapshot()], narrations: MarketAiNarration[] = []): MarketMonitorStore {
  return {
    snapshots: vi.fn(async () => rows), narrations: vi.fn(async () => narrations),
    latestSeries: vi.fn(async () => ({ daily: bars(), dailyMeta: { sourceId: 'coinbase' } })),
    archive: vi.fn(async (id: string) => { const row = rows.find(s => s.id === id); return row ? { snapshot: row, input: { asset: 'BTC', asOf: row.capturedAt, strategyVersion: row.analysisInput!.strategyVersion } } : null }),
  } as unknown as MarketMonitorStore
}

describe('fixed-window historical review', () => {
  it('uses only post-publication sessions, keeps forming bars out, and matches each trend to its horizon', () => {
    const row = sample()
    const result = reviewOutcomes(row, 'BTC', bars(), new Date('2026-09-18T12:00:00Z'))
    expect(result[0]).toMatchObject({ status: 'complete', start: '2026-09-11', end: '2026-09-11', entry: 100, close: 109, direction: 'bullish', verdict: 'supported' })
    expect(result[1]).toMatchObject({ targetBars: 7, observedBars: 7, end: '2026-09-17', status: 'complete' })
    expect(result[2]).toMatchObject({ targetBars: 30, observedBars: 7, status: 'pending', changePercent: null })
    expect(result[0].range).toEqual({ above: 1, below: 0, inside: 0 })
    expect(result[0].lowPercent).toBeCloseTo(-5)
  })

  it('treats missing boundaries, gaps, duplicates and bad prices as unavailable, not successes', () => {
    const at = new Date('2026-09-20')
    expect(reviewOutcomes(sample(), 'BTC', bars().slice(2), at)[0].status).toBe('missing-data')
    expect(reviewOutcomes(sample(), 'BTC', bars().filter(b => b.date !== '2026-09-11'), at)[0].status).toBe('missing-data')
    const duplicate = bars(); duplicate.splice(2, 0, duplicate[1]!)
    expect(reviewOutcomes(sample(), 'BTC', duplicate, at)[0].status).toBe('missing-data')
    expect(reviewOutcomes(sample(), 'BTC', duplicate, at)[1].status).toBe('missing-data')
    const invalid = bars(); invalid[1]!.open = NaN
    expect(reviewOutcomes(sample(), 'BTC', invalid, at)[0].status).toBe('missing-data')
    expect(reviewOutcomes(sample(), 'BTC', bars(1), at)[0].status).toBe('missing-data')
  })

  it('excludes ambiguous missing equity weekdays rather than moving the entry past a hole', () => {
    const row = sample(); row.sessionDate = '2026-09-10'
    const data = bars().filter(bar => !['2026-09-11', '2026-09-12', '2026-09-13'].includes(bar.date))
    expect(reviewOutcomes(row, 'TSLA', data, new Date('2026-09-18T21:00:00Z'))[0].status).toBe('missing-data')
  })

  it('keeps flat and non-directional judgments out of inflated binary hit rates', () => {
    const flat = bars(); flat[1]!.close = 100.1
    const row = sample(); row.outcomes = reviewOutcomes(row, 'BTC', flat, new Date('2026-09-18T12:00:00Z'))
    const summary = summarizeReview([row]).summaries[0]!
    expect(summary).toMatchObject({ flat: 1, scored: 1, agreementPercent: 0 })
    row.original = { ...snapshot(), trend: { ...trend, short: { ...trend.short, direction: 'sideways' } } }
    expect(reviewOutcomes(row, 'BTC', flat, new Date('2026-09-18'))[0].verdict).toBe('not-scored')
  })

  it('counts observed stock sessions and respects New York dates across DST', () => {
    expect(reviewSessionDate('TSLA', '2026-11-02T02:00:00Z')).toBe('2026-11-01')
    const row = sample(); row.sessionDate = '2026-09-11'
    const stockBars = bars().filter(b => !['2026-09-12', '2026-09-13'].includes(b.date))
    expect(reviewOutcomes(row, 'TSLA', stockBars, new Date('2026-09-18T21:00:00Z'))[1]).toMatchObject({ start: '2026-09-14', end: '2026-09-18', targetBars: 5, status: 'complete' })
    expect(reviewOutcomes(row, 'TSLA', stockBars, new Date('2026-09-18T19:00:00Z'))[1].status).toBe('pending')
  })

  it('selects the first daily observation per version without letting later intraday results multiply wins', async () => {
    const s = store([snapshot(), snapshot('later', '2026-09-10T14:00:00Z'), { ...snapshot('v3'), analysisInput: { hash: 'other', strategyVersion: 3 } }])
    const report = await buildMarketReview(s, 'BTC', 'evidence-chain-v1', 30, new Date('2026-09-18'))
    expect(report.rows.map(r => r.id)).toEqual(['first', 'v3'])
    expect(report.rows.map(r => r.strategyVersion)).toEqual([2, 3])
    expect(report.lessons.map(l => l.code)).toEqual(expect.arrayContaining(['collect-more', 'path-risk', 'mixed-trends']))
    expect(report.rows[0]!.original!.hypothesis.summary).toBe('Original reasoning')
    expect(report.rows[0]!.original).not.toHaveProperty('chart')
  })

  it('does not count unarchived or corrupt records, and separates versions', async () => {
    const s = store([snapshot(), snapshot('bad', '2026-09-11T12:00:00Z')])
    vi.mocked(s.archive).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('private path'))
    const report = await buildMarketReview(s, 'BTC', 'evidence-chain-v1', 30, new Date('2026-09-18'))
    expect(report.rows.map(r => r.archiveStatus)).toEqual(['unavailable', 'invalid'])
    expect(report.summaries.every(s => s.scored === 0 && s.excluded === 2)).toBe(true)
    expect(JSON.stringify(report)).not.toContain('private path')
    const row = sample(); row.outcomes = reviewOutcomes(row, 'BTC', bars(), new Date('2026-09-18'))
    expect(summarizeReview([row, { ...row, id: 'v3', strategyVersion: 3 }]).summaries).toHaveLength(6)
  })

  it('anchors daily prose to publication, verifies its original basis, and never scores its free text as a forecast', async () => {
    const narration = { id: 'narration', asset: 'BTC', strategyId: 'evidence-chain-v1', generatedAt: '2026-09-12T10:00:00Z', basis: { snapshotId: 'first', inputHash: 'hash', fingerprint: 'original', strategyVersion: 2 }, headline: 'Original prose' } as MarketAiNarration
    const s = store([snapshot()], [narration])
    const report = await buildMarketReview(s, 'BTC', 'evidence-chain-v1', 30, new Date('2026-09-18'))
    const row = report.rows[1]!
    expect(row.outcomes[0]).toMatchObject({ start: '2026-09-13', status: 'complete', verdict: 'not-scored' })
    expect(report.summaries[0]!.total).toBe(1)
    narration.basis!.inputHash = 'wrong'
    const invalid = await buildMarketReview(s, 'BTC', 'evidence-chain-v1', 30, new Date('2026-09-18'))
    expect(invalid.rows[1]!.archiveStatus).toBe('invalid')
    expect(invalid.rows[1]!.original).toBeNull()
  })

  it('exposes source changes, truncation and compact traceable feedback without any writes or external reads', async () => {
    const s = store()
    vi.mocked(s.latestSeries).mockResolvedValue({ daily: bars(), dailyMeta: { sourceId: 'yfinance' } } as never)
    const report = await buildMarketReview(s, 'BTC', 'evidence-chain-v1', 7, new Date('2026-09-16'))
    expect(report.rows[0]!.providerChanged).toBe(true)
    const feedback = reviewFeedback(report)
    expect(feedback.cases[0]!.id).toBe('first')
    expect(feedback.guidance).toContain('untouched future validation')
    expect(report.lessons.some(l => l.code === 'feed-change')).toBe(true)
  })
})
