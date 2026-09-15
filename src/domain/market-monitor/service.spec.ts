import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BarService, OhlcvBar } from '../market-data/bars/index.js'
import type { EquityClientLike } from '../market-data/client/types.js'
import type { ReferenceDataService } from '../market-data/reference/types.js'
import { MarketContextProviderRegistry } from './context.js'
import { createMarketMonitorService } from './service.js'
import { createMarketMonitorStore, type MarketMonitorStore } from './store.js'
import { createMarketMonitorScheduler } from './scheduler.js'
import { createMarketMonitorStrategyRegistry, evidenceChainV1Strategy } from './strategy.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS, type MarketAiNarration, type MarketMonitorAlert, type MarketMonitorReceipt, type MarketMonitorSnapshot } from './types.js'

function bars(count: number, step: number): OhlcvBar[] {
  return Array.from({ length: count }, (_, index) => ({ date: new Date(Date.parse('2026-01-01T00:00:00Z') + index * step).toISOString(), open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 1000 + index }))
}

function memoryStore(): MarketMonitorStore & { data: { snapshots: MarketMonitorSnapshot[]; alerts: MarketMonitorAlert[]; receipts: MarketMonitorReceipt[]; narrations: MarketAiNarration[] } } {
  const data = { snapshots: [] as MarketMonitorSnapshot[], alerts: [] as MarketMonitorAlert[], receipts: [] as MarketMonitorReceipt[], narrations: [] as MarketAiNarration[] }
  let settings = { ...DEFAULT_MARKET_MONITOR_SETTINGS }
  const series = new Map<string, MarketMonitorSnapshot['chart']>()
  return {
    data,
    settings: async () => settings,
    saveSettings: async (next) => { settings = next },
    snapshots: async (asset, limit = 100) => data.snapshots.filter((row) => !asset || row.asset === asset).slice(-limit),
    appendSnapshot: async (row) => { data.snapshots.push(row) },
    alerts: async (asset, limit = 100) => data.alerts.filter((row) => !asset || row.asset === asset).slice(-limit),
    appendAlert: async (row) => { data.alerts.push(row) },
    receipts: async (asset, limit = 100) => data.receipts.filter((row) => !asset || row.asset === asset).slice(-limit),
    appendReceipt: async (row) => { data.receipts.push(row) },
    narrations: async (asset, limit = 100) => data.narrations.filter((row) => !asset || row.asset === asset).slice(-limit),
    appendNarration: async (row) => { data.narrations.push(row) },
    latestSeries: async (asset, strategyId = 'evidence-chain-v1') => series.get(`${asset}:${strategyId}`) ?? null,
    saveLatestSeries: async (asset, chart, strategyId = 'evidence-chain-v1') => { series.set(`${asset}:${strategyId}`, chart) },
  }
}

function dependencies(hourly = true) {
  const daily = bars(90, 86400000)
  const intraday = bars(48, 3600000)
  const barService = { getBars: vi.fn(async (_ref, opts: { interval: string }) => {
    if (opts.interval === '1h' && !hourly) throw new Error('hourly unavailable')
    const rows = opts.interval === '1h' ? intraday : daily
    return { bars: rows, meta: { symbol: 'TSLA', from: rows[0].date, to: rows.at(-1)!.date, bars: rows.length, source: 'vendor' as const, sourceId: 'yfinance', provider: 'yfinance', interval: opts.interval } }
  }) } as unknown as BarService
  const equityClient = {
    getKeyMetrics: vi.fn(async () => [{ market_cap: 1e12, price_to_earnings: 80 }]),
    getEstimateConsensus: vi.fn(async () => [{ target_consensus: 350 }]),
    getShareStatistics: vi.fn(async () => [{ short_percent_of_float: 0.03 }]),
  } as unknown as EquityClientLike
  const reference = { calendar: vi.fn(async () => ({ earnings: [], ipos: [], dividends: [], window: { start: '2026-01-01', end: '2026-04-01' }, meta: { provider: 'test', asOf: '2026-01-01' } })) } as unknown as ReferenceDataService
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    if (String(input).includes('data.sec.gov')) {
      return new Response(JSON.stringify({ filings: { recent: { form: [], accessionNumber: [], filingDate: [], reportDate: [], primaryDocument: [], primaryDocDescription: [] } } }), { status: 200 })
    }
    return new Response(JSON.stringify({ result: [] }), { status: 200 })
  }) as typeof fetch
  return { barService, equityClient, reference, fetcher }
}

describe('market monitor service', () => {
  it('runs browser-free with real persisted receipts and resumes cadence after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-monitor-background-'))
    let clock = Date.parse('2026-09-13T00:00:00Z')
    const now = () => new Date(clock)
    let scheduler: ReturnType<typeof createMarketMonitorScheduler> | undefined
    try {
      const store = createMarketMonitorStore(root)
      expect((await store.settings()).backgroundEnabled).toBe(false)
      await store.saveSettings({ ...DEFAULT_MARKET_MONITOR_SETTINGS, backgroundEnabled: true, enabledAssets: ['TSLA'], intervalMinutes: 1 })
      scheduler = createMarketMonitorScheduler(createMarketMonitorService({ ...dependencies(), store, now }), { now })
      scheduler.start()
      await scheduler.tick()
      await scheduler.stop()
      const reopenedStore = createMarketMonitorStore(root)
      expect(await reopenedStore.receipts('TSLA')).toHaveLength(1)
      expect((await reopenedStore.settings()).backgroundEnabled).toBe(true)
      scheduler = createMarketMonitorScheduler(createMarketMonitorService({ ...dependencies(), store: reopenedStore, now }), { now })
      scheduler.start()
      await scheduler.tick()
      expect(await reopenedStore.receipts('TSLA')).toHaveLength(1)
      clock += 60_000
      await scheduler.tick()
      expect((await reopenedStore.receipts('TSLA')).map((row) => [row.trigger, row.outcome])).toEqual([['scheduled', 'stored'], ['scheduled', 'duplicate']])
      await reopenedStore.saveSettings({ ...await reopenedStore.settings(), backgroundEnabled: false })
      clock += 60_000
      await scheduler.tick()
      expect(await reopenedStore.receipts('TSLA')).toHaveLength(2)
      expect(await reopenedStore.receipts('BTC')).toHaveLength(0)
    } finally {
      await scheduler?.stop()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('coalesces overlapping manual/scheduled requests into one attributed scan', async () => {
    const store = memoryStore()
    const deps = dependencies()
    const service = createMarketMonitorService({ ...deps, store })
    const manual = service.scan('TSLA', 'manual')
    const scheduled = service.scan('TSLA', 'scheduled')
    expect(service.isScanning('TSLA')).toBe(true)
    expect(manual).toBe(scheduled)
    const [a, b] = await Promise.all([manual, scheduled])
    expect(a.receipt.id).toBe(b.receipt.id)
    expect(a.receipt.trigger).toBe('manual')
    expect(a.receipt.completedAt).toBeDefined()
    expect(store.data.receipts).toHaveLength(1)
    expect(store.data.snapshots).toHaveLength(1)
    expect(deps.barService.getBars).toHaveBeenCalledTimes(2)
    expect(deps.barService.getBars).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ interval: '1d', count: 400 }))
    expect(service.isScanning('TSLA')).toBe(false)
    await service.scan('TSLA', 'scheduled')
    expect(store.data.receipts).toHaveLength(2)
  })

  it('scans MSTR through the reusable equity context provider', async () => {
    const store = memoryStore()
    const deps = dependencies()
    const service = createMarketMonitorService({ ...deps, store, now: () => new Date('2026-04-01T00:00:00Z') })
    const result = await service.scan('MSTR', 'manual')
    expect(result.snapshot.asset).toBe('MSTR')
    expect(deps.equityClient.getKeyMetrics).toHaveBeenCalledWith({ symbol: 'MSTR' })
    expect(deps.equityClient.getEstimateConsensus).toHaveBeenCalledWith({ symbol: 'MSTR' })
    expect(deps.equityClient.getShareStatistics).toHaveBeenCalledWith({ symbol: 'MSTR' })
    expect(result.snapshot.sourceHealth).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mstr-reference' }),
      expect.objectContaining({ id: 'mstr-calendar-news' }),
      expect.objectContaining({ id: 'mstr-sec-filings', provider: 'SEC EDGAR', status: 'ok' }),
    ]))
  })

  it('prefers Alpaca bars for monitored equities and explicitly falls back to Yahoo', async () => {
    const store = memoryStore()
    const deps = dependencies()
    await createMarketMonitorService({ ...deps, store }).scan('TSLA', 'manual')
    expect(deps.barService.getBars).toHaveBeenNthCalledWith(1, { barId: 'alpaca|TSLA', assetClass: 'equity' }, expect.objectContaining({ interval: '1d' }))
    expect(deps.barService.getBars).toHaveBeenNthCalledWith(2, { barId: 'alpaca|TSLA', assetClass: 'equity' }, expect.objectContaining({ interval: '1h' }))

    const fallbackDeps = dependencies()
    vi.mocked(fallbackDeps.barService.getBars).mockImplementation(async (ref, opts) => {
      if ('barId' in ref && ref.barId.startsWith('alpaca|')) throw new Error('Alpaca credentials are not configured')
      const rows = opts.interval === '1h' ? bars(48, 3600000) : bars(90, 86400000)
      return { bars: rows, meta: { symbol: 'TSLA', from: rows[0]!.date, to: rows.at(-1)!.date, bars: rows.length, source: 'vendor', sourceId: 'yfinance', provider: 'yfinance', interval: opts.interval } }
    })
    const fallback = await createMarketMonitorService({ ...fallbackDeps, store: memoryStore() }).scan('TSLA', 'manual')
    expect(fallback.snapshot.sourceHealth).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'daily-bars', status: 'degraded', provider: 'yfinance', detail: expect.stringContaining('alpaca') }),
      expect.objectContaining({ id: 'intraday-bars', status: 'degraded', provider: 'yfinance', detail: expect.stringContaining('fallback used') }),
    ]))
  })

  it('prefers Coinbase bars for BTC and explicitly falls back to Yahoo', async () => {
    const deps = dependencies()
    await createMarketMonitorService({ ...deps, store: memoryStore() }).scan('BTC', 'manual')
    expect(deps.barService.getBars).toHaveBeenNthCalledWith(1, { barId: 'coinbase|BTC-USD', assetClass: 'crypto' }, expect.objectContaining({ interval: '1d' }))
    expect(deps.barService.getBars).toHaveBeenNthCalledWith(2, { barId: 'coinbase|BTC-USD', assetClass: 'crypto' }, expect.objectContaining({ interval: '1h' }))

    const fallbackDeps = dependencies()
    vi.mocked(fallbackDeps.barService.getBars).mockImplementation(async (ref, opts) => {
      if ('barId' in ref && ref.barId.startsWith('coinbase|')) throw new Error('Coinbase unavailable')
      const rows = opts.interval === '1h' ? bars(48, 3600000) : bars(90, 86400000)
      return { bars: rows, meta: { symbol: 'BTC-USD', from: rows[0]!.date, to: rows.at(-1)!.date, bars: rows.length, source: 'vendor', sourceId: 'yfinance', provider: 'yfinance', interval: opts.interval } }
    })
    const fallback = await createMarketMonitorService({ ...fallbackDeps, store: memoryStore() }).scan('BTC', 'manual')
    expect(fallback.snapshot.sourceHealth).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'daily-bars', status: 'degraded', provider: 'yfinance', detail: expect.stringContaining('coinbase') }),
      expect.objectContaining({ id: 'intraday-bars', status: 'degraded', provider: 'yfinance', detail: expect.stringContaining('fallback used') }),
    ]))
  })

  it('releases its scan lock after failure so later attempts can recover', async () => {
    const store = memoryStore()
    const deps = dependencies()
    vi.mocked(deps.barService.getBars).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'))
    const service = createMarketMonitorService({ ...deps, store })
    await expect(service.scan('TSLA', 'scheduled')).rejects.toThrow('offline')
    expect(service.isScanning('TSLA')).toBe(false)
    expect(store.data.receipts[0]).toMatchObject({ outcome: 'failed', completedAt: expect.any(String) })
    expect((await service.scan('TSLA', 'manual')).stored).toBe(true)
  })

  it('stores one semantic observation and records duplicate scan receipts', async () => {
    const store = memoryStore()
    const service = createMarketMonitorService({ ...dependencies(), store, now: () => new Date('2026-04-01T00:00:00Z') })
    expect((await service.scan('TSLA', 'manual')).stored).toBe(true)
    expect((await service.scan('TSLA', 'scheduled')).stored).toBe(false)
    expect(store.data.snapshots).toHaveLength(1)
    expect(store.data.snapshots[0]).toMatchObject({
      trend: { alignment: expect.any(String) },
      wyckoff: { phaseCandidate: expect.any(String), confidence: expect.any(Number) },
      dailyBrief: { cadence: 'daily-bar', periodKey: '2026-03-31', narrator: 'deterministic-v1' },
    })
    expect(store.data.snapshots[0].chart.daily).toEqual([])
    expect((await service.snapshots('TSLA', 1))[0].chart.daily).toHaveLength(90)
    expect(store.data.receipts.map((row) => [row.trigger, row.outcome])).toEqual([['manual', 'stored'], ['scheduled', 'duplicate']])
    expect(store.data.receipts.every((row) => row.strategyId === 'evidence-chain-v1' && Number.isFinite(row.durationMs) && row.sourceHealth?.length)).toBe(true)
    expect((await service.health('TSLA')).summary).toMatchObject({ attempts: 2, duplicates: 1, scansWithSourceChecks: 2 })
  })

  it('publishes at most one Codex narration per asset, strategy and daily period', async () => {
    const store = memoryStore()
    const service = createMarketMonitorService({ ...dependencies(), store, now: () => new Date('2026-04-01T00:00:00Z') })
    const daily = await service.dailyNarrationInput(['TSLA'])
    expect(daily.assets[0]).toMatchObject({ asset: 'TSLA', status: 'ready', periodKey: '2026-03-31' })
    const input = {
      asset: 'TSLA' as const, strategyId: 'evidence-chain-v1', periodKey: '2026-03-31',
      headline: '区间等待确认', summary: '事实与解释保持分离。', shortTerm: '转换中', mediumTerm: '横盘', longTerm: '偏多',
      evidence: ['价格仍在区间内'], risks: ['向下跌破'], watchFor: ['等待测试'],
    }
    const provenance = { workspaceId: 'chat-1', runId: 'run-1', issueId: 'mad42lab-market-daily-interpretation', agent: 'codex' }
    expect((await service.publishNarration(input, provenance)).stored).toBe(true)
    expect((await service.publishNarration({ ...input, headline: '不得覆盖' }, { ...provenance, runId: 'run-2' })).stored).toBe(false)
    expect(store.data.narrations).toHaveLength(1)
    expect((await service.snapshots('TSLA', 1))[0].aiNarration).toMatchObject({ headline: '区间等待确认', provenance: { runId: 'run-1' } })
    expect((await service.dailyNarrationInput(['TSLA'])).assets[0].status).toBe('already-published')
  })

  it('rejects narration without a matching deterministic brief or Codex provenance', async () => {
    const service = createMarketMonitorService({ ...dependencies(), store: memoryStore() })
    const input = { asset: 'BTC' as const, strategyId: 'evidence-chain-v1', periodKey: '2099-01-01', headline: 'x', summary: 'x', shortTerm: 'x', mediumTerm: 'x', longTerm: 'x', evidence: [], risks: [], watchFor: [] }
    await expect(service.publishNarration(input, { workspaceId: 'w', runId: 'r', issueId: 'i', agent: 'claude' })).rejects.toThrow('Codex')
    await expect(service.publishNarration(input, { workspaceId: 'w', runId: 'r', issueId: 'mad42lab-market-daily-interpretation', agent: 'codex' })).rejects.toThrow('does not match')
  })

  it('keeps an unavailable hourly source explicit instead of using daily bars', async () => {
    const store = memoryStore()
    const service = createMarketMonitorService({ ...dependencies(false), store, now: () => new Date('2026-04-01T00:00:00Z') })
    const result = await service.scan('TSLA', 'manual')
    expect(result.snapshot.metrics.intraday.available).toBe(false)
    expect(result.snapshot.chart.intraday).toEqual([])
    expect(result.snapshot.sourceHealth.find((source) => source.id === 'intraday-bars')?.status).toBe('unavailable')
  })

  it('retains the last valid BTC context when Deribit is temporarily unavailable', async () => {
    const store = memoryStore()
    let unavailable = false
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (unavailable) throw new Error('temporary derivatives outage')
      const isOption = String(input).includes('kind=option')
      const result = isOption
        ? [{ instrument_name: 'BTC-27SEP26-100000-C', open_interest: 25 }, { instrument_name: 'BTC-27SEP26-100000-P', open_interest: 10 }]
        : [{ instrument_name: 'BTC-PERPETUAL', funding_8h: 0.0001, open_interest: 100_000, mark_price: 90_000 }]
      return new Response(JSON.stringify({ result }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const service = createMarketMonitorService({ ...dependencies(), store, fetcher, now: () => new Date('2026-04-01T00:00:00Z') })
    const first = await service.scan('BTC', 'manual')
    unavailable = true
    const second = await service.scan('BTC', 'scheduled')
    expect(second.snapshot.context).toMatchObject({ fundingRate: first.snapshot.context.fundingRate, openInterest: first.snapshot.context.openInterest })
    expect(second.snapshot.sourceHealth.find((source) => source.id === 'btc-derivatives')).toMatchObject({ status: 'unavailable' })
    expect(second.snapshot.sourceHealth.find((source) => source.id === 'btc-derivatives')?.detail).toContain('Last valid fields retained')
  })

  it('selects an injected strategy through persisted settings', async () => {
    const store = memoryStore()
    const analyze = vi.fn(evidenceChainV1Strategy.analyze)
    const strategyRegistry = createMarketMonitorStrategyRegistry([{
      manifest: { id: 'review-strategy-v1', label: 'Review strategy', version: 1, description: 'Test strategy module.', requiredData: ['daily-bars'] },
      analyze,
      fingerprint: evidenceChainV1Strategy.fingerprint,
    }])
    const service = createMarketMonitorService({ ...dependencies(), store, strategyRegistry, now: () => new Date('2026-04-01T00:00:00Z') })
    await service.scan('TSLA', 'manual')
    await service.saveSettings({ ...DEFAULT_MARKET_MONITOR_SETTINGS, strategyId: 'review-strategy-v1' })
    const result = await service.scan('TSLA', 'manual')
    expect(result.snapshot.strategyId).toBe('review-strategy-v1')
    expect(analyze).toHaveBeenCalledOnce()
    expect(service.strategies().map((strategy) => strategy.id)).toEqual(['evidence-chain-v1', 'review-strategy-v1'])
    expect((await service.snapshots('TSLA', 1, 'evidence-chain-v1')).at(-1)?.chart.daily).toHaveLength(90)
    expect((await service.snapshots('TSLA', 1, 'review-strategy-v1')).at(-1)?.chart.daily).toHaveLength(90)
    expect((await service.evaluation('TSLA')).samples).toBe(1)
  })

  it('composes multiple context providers and isolates a provider failure', async () => {
    const contextProviderRegistry = new MarketContextProviderRegistry([
      {
        manifest: { id: 'btc-positioning', label: 'BTC positioning', assets: ['BTC'], description: 'fixture' },
        load: vi.fn(async () => ({ context: { fundingRate: 0.0001 }, health: [{ id: 'btc-positioning', label: 'BTC positioning', status: 'ok' as const, provider: 'fixture', asOf: '2026-04-01T00:00:00Z', detail: 'loaded' }] })),
      },
      {
        manifest: { id: 'btc-onchain', label: 'BTC on-chain', assets: ['BTC'], description: 'fixture' },
        load: vi.fn(async () => { throw new Error('on-chain unavailable') }),
      },
    ])
    const service = createMarketMonitorService({ ...dependencies(), store: memoryStore(), contextProviderRegistry, now: () => new Date('2026-04-01T00:00:00Z') })
    const result = await service.scan('BTC', 'manual')
    expect(result.snapshot.context.fundingRate).toBe(0.0001)
    expect(result.snapshot.sourceHealth).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'btc-positioning', status: 'ok' }),
      expect.objectContaining({ id: 'context-provider:btc-onchain', status: 'unavailable' }),
    ]))
  })
})
