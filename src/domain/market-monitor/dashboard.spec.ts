import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildCoreDashboard, createMarketDashboard, dashboardContextMetrics } from './dashboard.js'
import { createMarketMonitorStore, type MarketMonitorStore } from './store.js'
import type { MarketMonitorSnapshot } from './types.js'
import type { DashboardModule, DashboardObservation } from './dashboard-types.js'
import type { BarService } from '../market-data/bars/index.js'

const NOW = new Date('2026-09-18T12:00:00Z')
function snapshot(overrides: Partial<MarketMonitorSnapshot> = {}): MarketMonitorSnapshot {
  return { id: '00000000-0000-4000-8000-000000000001', asset: 'BTC', strategyId: 'evidence-chain-v1', capturedAt: '2026-09-17T12:00:00Z',
    metrics: { lastPrice: 100 }, hypothesis: { label: '区间候选', confidence: 60 }, analysisInput: { strategyVersion: 2, hash: 'fixture' },
    context: { fundingRate: 0, openInterest: 2000, putCallOpenInterestRatio: 0.5 },
    sourceHealth: [{ id: 'btc-derivatives', label: 'BTC', status: 'ok', provider: 'Deribit public API', asOf: '2026-09-17T12:00:00Z', detail: 'public' }],
    wyckoff: { events: [{ kind: 'upthrust', status: 'confirmed', at: '2026-09-16', level: 110 }] },
    chart: { daily: [], intraday: [], dailyMeta: { sourceId: 'coinbase' }, intradayMeta: null }, ...overrides,
  } as MarketMonitorSnapshot
}
function observation(row = snapshot()): DashboardObservation {
  return { kind: 'scan-context', asset: row.asset, strategyId: row.strategyId, capturedAt: row.capturedAt, snapshotId: row.id, metrics: dashboardContextMetrics(row) }
}
async function withStore(run: (store: ReturnType<typeof createMarketMonitorStore>, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'market-research-'))
  try { await run(createMarketMonitorStore(root), root) } finally { await rm(root, { recursive: true, force: true }) }
}

describe('research dashboard', () => {
  it('records an unavailable mNAV marker after a provider failure without inventing a chart point', async () => withStore(async store => {
    const read = vi.fn().mockResolvedValueOnce({ id: 'strategy', label: 'Strategy', notes: [], events: [], series: [], metrics: [{
      id: 'strategy-mnav', label: 'mNAV', value: 2, unit: 'ratio', description: 'Synthetic', source: { provider: 'Strategy', dataAt: NOW.toISOString(), fetchedAt: NOW.toISOString(), status: 'ok', formulaVersion: 'strategy-net-bps-2026-07-23' },
    }] }).mockRejectedValueOnce(new Error('unavailable'))
    const service = createMarketDashboard({ store, barService: {} as BarService, now: () => NOW, readers: { MSTR: { read } } })
    await service.read('MSTR', 90)
    const failed = await service.read('MSTR', 90)
    const observations = await store.dashboardObservations('MSTR')
    expect(observations).toHaveLength(2)
    expect(observations.at(-1)!.metrics[0]).toMatchObject({ id: 'strategy-mnav', value: null, source: { status: 'unavailable' } })
    expect(failed.modules[1]!.series.flatMap(s => s.points)).toEqual([{ at: NOW.toISOString(), value: 2 }])
  }))
  it('preserves zero funding and converts fractional funding exactly once', () => {
    expect(dashboardContextMetrics(snapshot()).find(m => m.id === 'funding-8h')?.value).toBe(0)
    expect(dashboardContextMetrics(snapshot({ context: { fundingRate: 0.0001 } })).find(m => m.id === 'funding-8h')?.value).toBe(0.01)
  })

  it('shows closed price history and separately timestamps when an event became known', async () => withStore(async store => {
    const row = snapshot()
    await store.appendSnapshot(row)
    await store.saveLatestSeries('BTC', { ...row.chart, daily: [
      { date: '2026-09-16', open: 95, high: 101, low: 94, close: 100, volume: 20 },
      { date: '2026-09-17', open: 100, high: 102, low: 99, close: 101, volume: 20 },
      { date: '2026-09-18', open: 101, high: 999, low: 99, close: 999, volume: 20 },
    ] })
    const report = await buildCoreDashboard(store, 'BTC', row.strategyId, 30, NOW)
    expect(report.series.find(s => s.id === 'price-close')?.points).toEqual([{ at: '2026-09-16', value: 100 }, { at: '2026-09-17', value: 101 }])
    expect(report.events.find(e => e.kind === 'wyckoff')).toMatchObject({ at: '2026-09-16', availableAt: row.capturedAt, snapshotId: row.id })
    expect(report.events.filter(e => e.kind === 'judgment')).toHaveLength(1)
  }))

  it('retains context from duplicate scans across restart but skips stale, future and unknown timestamps', async () => withStore(async (store, root) => {
    const row = snapshot()
    await store.appendSnapshot(row)
    await store.appendDashboardObservation(observation(row))
    const second = snapshot({ capturedAt: '2026-09-18T11:45:00Z', context: { fundingRate: 0.0002 }, sourceHealth: [{ ...row.sourceHealth[0], asOf: '2026-09-18T11:45:00Z' }] })
    await store.appendDashboardObservation(observation(second))
    const retained = observation({ ...second, capturedAt: '2026-09-18T11:50:00Z', sourceHealth: [{ ...second.sourceHealth[0], status: 'unavailable', asOf: null, retained: { asOf: '2026-09-18T11:45:00Z', expiresAt: '2026-09-18T12:15:00Z', fields: ['fundingRate'] } }] })
    await store.appendDashboardObservation(retained)
    const future = observation({ ...second, capturedAt: '2026-09-19T00:00:00Z' })
    await store.appendDashboardObservation(future)
    const module = await buildCoreDashboard(createMarketMonitorStore(root), 'BTC', row.strategyId, 30, NOW)
    const funding = module.series.find(s => s.id.startsWith('funding-8h:'))!
    expect(funding.points).toEqual([{ at: row.capturedAt, value: 0 }, { at: second.capturedAt, value: 0.02 }])
    expect(funding.maxGapMs).toBe(3_600_000)
  }))

  it('does not mix strategies, providers or formula versions', async () => withStore(async store => {
    const sample = observation()
    await store.appendDashboardObservation(sample)
    await store.appendDashboardObservation({ ...sample, strategyId: 'another-strategy', capturedAt: '2026-09-18T10:00:00Z' })
    await store.appendDashboardObservation({ ...sample, metrics: sample.metrics.map(m => ({ ...m, source: { ...m.source, provider: 'other venue', formulaVersion: 'v2' } })) })
    const report = await buildCoreDashboard(store, 'BTC', sample.strategyId, 30, NOW)
    expect(report.series.filter(s => s.id.startsWith('funding-8h:'))).toHaveLength(2)
    expect(report.series.flatMap(s => s.points).every(p => p.at !== '2026-09-18T10:00:00Z')).toBe(true)
  }))

  it('archives research at acquisition time, keeps unknown report dates, and deduplicates cached reads', async () => withStore(async store => {
    const research: DashboardModule = { id: 'strategy', label: 'Strategy', events: [], notes: [], series: [], metrics: [{
      id: 'mstr-holdings', label: '持币', value: 123, unit: 'btc', description: 'issuer',
      source: { provider: 'Strategy', dataAt: null, fetchedAt: NOW.toISOString(), status: 'stale', formulaVersion: 'issuer-v1' },
    }] }
    const read = vi.fn(async () => research)
    const svc = createMarketDashboard({ store, barService: {} as BarService, now: () => NOW, readers: { MSTR: { read } } })
    const [first, second] = await Promise.all([svc.read('MSTR', 90), svc.read('MSTR', 90)])
    expect(read).toHaveBeenCalledOnce()
    expect(second).toEqual(first)
    await svc.read('MSTR', 90)
    expect(await store.dashboardObservations('MSTR')).toHaveLength(1)
    const history = first.modules[1].series[0]
    expect(history.points).toEqual([{ at: NOW.toISOString(), value: 123 }])
    expect(history.source.dataAt).toBeNull()
    expect(history.source.status).toBe('stale')
  }))

  it('isolates a research provider outage and rejects unsupported windows', async () => withStore(async store => {
    const service = createMarketDashboard({ store, barService: {} as BarService, now: () => NOW, readers: { BTC: { read: vi.fn().mockRejectedValue(new Error('secret transport must not escape')) } } })
    const result = await service.read('BTC', 30)
    expect(result.modules).toHaveLength(2)
    expect(JSON.stringify(result)).not.toContain('secret transport')
    await expect(service.read('BTC', 7 as 30)).rejects.toThrow('window')
  }))

  it('serializes the same acquisition across different response windows', async () => {
    const journal: DashboardObservation[] = []
    const research: DashboardModule = { id: 'strategy', label: 'Strategy', events: [], notes: [], series: [], metrics: [{
      id: 'mstr-holdings', label: '持币', value: 123, unit: 'btc', description: 'issuer',
      source: { provider: 'Strategy', dataAt: '2026-09-17', fetchedAt: NOW.toISOString(), status: 'ok', formulaVersion: 'issuer-v1' },
    }] }
    const append = vi.fn(async (row: DashboardObservation) => { journal.push(row) })
    const store = {
      settings: async () => ({ strategyId: 'evidence-chain-v1' }), snapshots: async () => [], latestSeries: async () => null, receipts: async () => [],
      dashboardObservations: async () => journal.slice(), appendDashboardObservation: append,
    } as unknown as MarketMonitorStore
    const service = createMarketDashboard({ store, barService: {} as BarService, now: () => NOW, readers: { MSTR: { read: async () => research } } })
    const reports = await Promise.all([service.read('MSTR', 30), service.read('MSTR', 90), service.read('MSTR', 365)])
    expect(reports.map(report => report.windowDays)).toEqual([30, 90, 365])
    expect(append).toHaveBeenCalledTimes(1)
    expect(journal).toHaveLength(1)
    expect(reports.every(report => report.modules[1]!.series[0]!.points.length === 1)).toBe(true)
  })

  it('records the first acquisition for a newly selected strategy even when public metric values match', async () => withStore(async store => {
    const research: DashboardModule = { id: 'strategy', label: 'Strategy', events: [], notes: [], series: [], metrics: [{
      id: 'mstr-holdings', label: '持币', value: 123, unit: 'btc', description: 'issuer',
      source: { provider: 'Strategy', dataAt: null, fetchedAt: NOW.toISOString(), status: 'stale', formulaVersion: 'issuer-v1' },
    }] }
    const settings = await store.settings()
    const service = createMarketDashboard({ store, barService: {} as BarService, now: () => NOW, readers: { MSTR: { read: async () => research } } })
    await service.read('MSTR', 90)
    await store.saveSettings({ ...settings, strategyId: 'alternate-strategy' })
    const switched = await service.read('MSTR', 90)
    const saved = await store.dashboardObservations('MSTR')
    expect(saved.map(row => row.strategyId)).toEqual([settings.strategyId, 'alternate-strategy'])
    expect(switched.modules[1]!.series[0]!.points).toEqual([{ at: NOW.toISOString(), value: 123 }])
    await service.read('MSTR', 30)
    expect(await store.dashboardObservations('MSTR')).toHaveLength(2)
  }))
})
