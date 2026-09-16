import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BarService, OhlcvBar } from '../market-data/bars/index.js'
import type { EquityClientLike } from '../market-data/client/types.js'
import type { ReferenceDataService } from '../market-data/reference/types.js'
import type { MarketAnalysisArchive } from './replay.js'
import { MarketContextProviderRegistry } from './context.js'
import { createMarketMonitorService } from './service.js'
import { createMarketMonitorStore, type MarketMonitorStore } from './store.js'
import { createMarketMonitorScheduler } from './scheduler.js'
import { createMarketMonitorStrategyRegistry, evidenceChainV1Strategy } from './strategy.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS, type MarketAiNarration, type MarketMonitorAlert, type MarketMonitorReceipt, type MarketMonitorSnapshot } from './types.js'

function bars(count: number, step: number, end = '2026-04-01T00:00:00Z'): OhlcvBar[] {
  return Array.from({ length: count }, (_, index) => ({ date: new Date(Date.parse(end) - (count - index) * step).toISOString(), open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 1000 + index }))
}

function memoryStore(): MarketMonitorStore & { data: { snapshots: MarketMonitorSnapshot[]; alerts: MarketMonitorAlert[]; receipts: MarketMonitorReceipt[]; narrations: MarketAiNarration[] } } {
  const data = { snapshots: [] as MarketMonitorSnapshot[], alerts: [] as MarketMonitorAlert[], receipts: [] as MarketMonitorReceipt[], narrations: [] as MarketAiNarration[] }
  let settings = { ...DEFAULT_MARKET_MONITOR_SETTINGS }
  const archives = new Map<string, MarketAnalysisArchive>()
  const series = new Map<string, MarketMonitorSnapshot['chart']>()
  return {
    data,
    archive: async (id) => archives.get(id) ?? null,
    saveArchive: async (value) => { archives.set(value.snapshot.id, structuredClone(value)) },
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

function dependencies(hourly = true, at = '2026-04-01T00:00:00Z') {
  const daily = bars(90, 86400000, at)
  const intraday = bars(48, 3600000, at)
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
  return { barService, equityClient, reference, fetcher, now: () => new Date(at) }
}

describe('market monitor service', () => {

  it('replays immutable disk inputs after restart without accessing live sources or current settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'monitor-replay-'))
    try {
      const deps = dependencies(), store = createMarketMonitorStore(root)
      const service = createMarketMonitorService({ ...deps, store })
      const first = await service.scan('TSLA', 'manual')
      const duplicate = await service.scan('TSLA', 'manual')
      expect(duplicate.snapshot.id).toBe(first.snapshot.id)
      expect(duplicate.receipt.snapshotId).toBe(first.snapshot.id)
      const archive = await store.archive(first.snapshot.id)
      expect(archive?.input.dailyBars).toHaveLength(90)
      await expect(store.saveArchive(archive!)).rejects.toMatchObject({ code: 'EEXIST' })
      await store.saveSettings({ ...DEFAULT_MARKET_MONITOR_SETTINGS, abnormalMovePercent: 99 })
      vi.mocked(deps.barService.getBars).mockRejectedValue(new Error('must not fetch'))
      const restarted = createMarketMonitorService({ ...deps, store: createMarketMonitorStore(root), now: () => new Date('2030-01-01') })
      expect(await restarted.replay(first.snapshot.id)).toMatchObject({ status: 'verified', differences: [], archive: { input: { abnormalMovePercent: 1.5 } } })
      expect((await restarted.replay('00000000-0000-4000-8000-000000000001')).status).toBe('unavailable')
      await expect(store.archive('../settings.json')).rejects.toThrow('identity')
      archive!.input.dailyBars[0].close += 10
      await writeFile(join(root, 'inputs', `${first.snapshot.id}.json.gz`), gzipSync(JSON.stringify(archive)))
      await expect(restarted.replay(first.snapshot.id)).rejects.toThrow('integrity')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('detects changed output and refuses an unsupported strategy version', async () => {
    const store = memoryStore(), service = createMarketMonitorService({ ...dependencies(), store })
    const { snapshot } = await service.scan('BTC', 'manual')
    const archive = (await store.archive(snapshot.id))!
    archive.snapshot.hypothesis.confidence = 999
    expect(await service.replay(snapshot.id)).toMatchObject({ status: 'mismatch', differences: ['hypothesis'] })
    archive.input.strategyVersion = 999
    expect((await service.replay(snapshot.id)).status).toBe('unsupported')
  })

  it('binds narration to a persisted duplicate and labels changed evidence and legacy narration honestly', async () => {
    const store = memoryStore(), deps = dependencies(), service = createMarketMonitorService({ ...deps, store })
    const first = await service.scan('TSLA', 'manual')
    const daily = (await service.dailyNarrationInput(['TSLA'])).assets[0]
    expect(daily.snapshotId).toBe(first.snapshot.id)
    const input = { snapshotId: daily.snapshotId!, inputHash: daily.inputHash!, asset: 'TSLA' as const, strategyId: 'evidence-chain-v1', periodKey: daily.periodKey!, headline: 'x', summary: 'x', shortTerm: 'x', mediumTerm: 'x', longTerm: 'x', evidence: [], risks: [], watchFor: [] }
    const provenance = { workspaceId: 'w', runId: 'r', issueId: 'mad42lab-market-daily-interpretation', agent: 'codex' }
    await expect(service.publishNarration({ ...input, inputHash: 'wrong' }, provenance)).rejects.toThrow('archived observation')
    // Evidence may move while Codex is composing; the original basis must survive.
    vi.mocked(deps.equityClient.getKeyMetrics).mockResolvedValue([{ market_cap: 2e12, price_to_earnings: 90 }] as never)
    const changed = await service.scan('TSLA', 'manual')
    expect(changed.stored).toBe(true)
    const published = await service.publishNarration(input, provenance)
    expect(published.narration.basis).toMatchObject({ snapshotId: first.snapshot.id, inputHash: daily.inputHash })
    const rows = await service.snapshots('TSLA')
    expect(rows[0].narrationStatus).toBe('current')
    expect(rows[1].narrationStatus).toBe('stale')
    delete store.data.narrations[0].basis
    expect((await service.snapshots('TSLA')).at(-1)?.narrationStatus).toBe('unverified')
  })

  it.each([0, 19])('falls back when Coinbase returns %s usable daily bars without throwing', async (count) => {
    const deps = dependencies()
    const original = deps.barService.getBars
    const good = await original({ symbol: 'BTC-USD', assetClass: 'crypto' }, { interval: '1d' })
    vi.mocked(deps.barService.getBars).mockImplementation(async (ref, opts) => {
      if ('barId' in ref && ref.barId.startsWith('coinbase|')) return { bars: good.bars.slice(0, count), meta: { ...good.meta, sourceId: 'coinbase', bars: count, quality: { scope: 'fetched_window_before_count', inspectedRows: 350, excludedRows: 350 - count, latestExcludedRecordAt: null, latestExcludedFields: ['open'], reason: 'missing_or_non_finite_ohlc' } } }
      return good
    })
    const result = await createMarketMonitorService({ ...deps, store: memoryStore() }).scan('BTC', 'manual')
    expect(result.snapshot.chart.daily).toHaveLength(90)
    expect(result.receipt.sourceHealth).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'daily-bars', provider: 'yfinance', status: 'degraded', detail: expect.stringContaining(`Only ${count} usable 1d bars`) }),
    ]))
  })

  it('preserves both daily source failures and their stage in receipts and health reports', async () => {
    const deps = dependencies(), store = memoryStore()
    vi.mocked(deps.barService.getBars).mockImplementation(async (ref) => {
      throw new Error('barId' in ref && ref.barId.startsWith('coinbase|') ? 'Coinbase HTTP 403: view denied' : 'Yahoo HTTP 429: rate limited')
    })
    const service = createMarketMonitorService({ ...deps, store })
    await expect(service.scan('BTC', 'manual')).rejects.toThrow(/daily-bars: BTC 1d: coinbase failed.*403.*yfinance failed.*429/)
    expect(deps.barService.getBars).toHaveBeenCalledTimes(2)
    expect(store.data.receipts[0]).toMatchObject({ failureStage: 'daily-bars', outcome: 'failed', sourceHealth: [
      { provider: 'coinbase', status: 'unavailable', detail: 'Coinbase HTTP 403: view denied' },
      { provider: 'yfinance', status: 'unavailable', detail: 'Yahoo HTTP 429: rate limited' },
    ] })
    const health = await service.health('BTC', 24)
    expect(health.summary.scansWithSourceIssues).toBe(1)
    expect(health.sources.map(source => [source.provider, source.unavailable])).toEqual([['coinbase', 1], ['yfinance', 1]])
  })

  it('rejects empty Yahoo fallback data and retains the original Coinbase reason', async () => {
    const deps = dependencies(), store = memoryStore()
    vi.mocked(deps.barService.getBars).mockRejectedValueOnce(new Error('Coinbase timed out')).mockResolvedValueOnce({ bars: [], meta: { symbol: 'BTC-USD', from: '', to: '', bars: 0, sourceId: 'yfinance' } })
    await expect(createMarketMonitorService({ ...deps, store }).scan('BTC', 'manual')).rejects.toThrow(/Coinbase timed out.*yfinance failed.*Only 0 usable 1d bars/)
  })

  it('continues daily analysis when both hourly sources fail and records both reasons', async () => {
    const deps = dependencies(false)
    const result = await createMarketMonitorService({ ...deps, store: memoryStore() }).scan('BTC', 'manual')
    expect(result.receipt.outcome).toBe('stored')
    expect(result.snapshot.chart.intraday).toEqual([])
    expect(result.receipt.sourceHealth).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'intraday-bars', status: 'unavailable', detail: expect.stringMatching(/BTC 1h: coinbase failed.*yfinance failed/) }),
    ]))
  })

  it('redacts credential-shaped text before persisting combined failures', async () => {
    const deps = dependencies(), store = memoryStore()
    vi.mocked(deps.barService.getBars).mockRejectedValue(new Error('HTTP 401 organizations/example/apiKeys/sentinel token=sentinel-secret Bearer sentinel-bearer eyJhbGciOi.test.signature'))
    await createMarketMonitorService({ ...deps, store }).scan('BTC', 'manual').catch(() => undefined)
    const persisted = JSON.stringify(store.data.receipts)
    expect(persisted).toContain('401')
    expect(persisted).not.toMatch(/sentinel|eyJhbGciOi/)
  })

  it('bounds each provider error without losing the fallback reason', async () => {
    const deps = dependencies(), store = memoryStore()
    vi.mocked(deps.barService.getBars).mockRejectedValueOnce(new Error(`Coinbase: ${'x'.repeat(2000)}`)).mockRejectedValueOnce(new Error('Yahoo HTTP 429'))
    await expect(createMarketMonitorService({ ...deps, store }).scan('BTC', 'manual')).rejects.toThrow(/coinbase failed.*yfinance failed \(Yahoo HTTP 429\)/)
    expect(store.data.receipts[0]!.error!.length).toBeLessThan(1500)
  })

  it('runs browser-free with real persisted receipts and resumes cadence after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-monitor-background-'))
    let clock = Date.parse('2026-09-13T00:00:00Z')
    const now = () => new Date(clock)
    let scheduler: ReturnType<typeof createMarketMonitorScheduler> | undefined
    try {
      const store = createMarketMonitorStore(root)
      expect((await store.settings()).backgroundEnabled).toBe(false)
      await store.saveSettings({ ...DEFAULT_MARKET_MONITOR_SETTINGS, backgroundEnabled: true, enabledAssets: ['TSLA'], intervalMinutes: 1 })
      scheduler = createMarketMonitorScheduler(createMarketMonitorService({ ...dependencies(true, now().toISOString()), store, now }), { now })
      scheduler.start()
      await scheduler.tick()
      await scheduler.stop()
      const reopenedStore = createMarketMonitorStore(root)
      expect(await reopenedStore.receipts('TSLA')).toHaveLength(1)
      expect((await reopenedStore.settings()).backgroundEnabled).toBe(true)
      scheduler = createMarketMonitorScheduler(createMarketMonitorService({ ...dependencies(true, now().toISOString()), store: reopenedStore, now }), { now })
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
      snapshotId: daily.assets[0].snapshotId!, inputHash: daily.assets[0].inputHash!,
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
    const input = { snapshotId: '00000000-0000-4000-8000-000000000001', inputHash: '0'.repeat(64), asset: 'BTC' as const, strategyId: 'evidence-chain-v1', periodKey: '2099-01-01', headline: 'x', summary: 'x', shortTerm: 'x', mediumTerm: 'x', longTerm: 'x', evidence: [], risks: [], watchFor: [] }
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

it('falls back on stale preferred daily candles even when their metadata claims success', async () => {
  const deps = dependencies()
  const original = vi.mocked(deps.barService.getBars).getMockImplementation()!
  vi.mocked(deps.barService.getBars).mockImplementation(async (ref, options) => {
    const result = await original(ref, options)
    return 'barId' in ref && ref.barId.startsWith('coinbase|') && options.interval === '1d'
      ? { ...result, bars: result.bars.map(row => ({ ...row, date: new Date(Date.parse(row.date) - 7 * 86400000).toISOString() })) }
      : result
  })
  const result = await createMarketMonitorService({ ...deps, store: memoryStore() }).scan('BTC', 'manual')
  expect(result.receipt.sourceHealth?.find(row => row.id === 'daily-bars')).toMatchObject({ provider: 'yfinance', status: 'degraded', detail: expect.stringMatching(/coinbase.*Stale 1d/) })
  expect(result.snapshot.analysisBasis).toMatchObject({ version: 2, closedBarsOnly: true })
})

it('does not resurrect old news when only SEC fails and the news result is successfully empty', async () => {
  const deps = dependencies(), store = memoryStore()
  const service = createMarketMonitorService({ ...deps, store })
  await service.scan('TSLA', 'manual')
  store.data.snapshots[0]!.context.recentNews = [{ title: 'Old headline', time: '2026-03-01', source: 'fixture' }]
  vi.mocked(deps.fetcher).mockRejectedValue(new Error('HTTP 403'))
  const next = await service.scan('TSLA', 'manual')
  expect(next.snapshot.context.recentNews).toEqual([])
  expect(next.snapshot.sourceHealth.find(row => row.id === 'tsla-sec-filings')?.detail).toContain('HTTP 403')
})
