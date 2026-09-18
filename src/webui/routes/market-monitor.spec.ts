import { describe, expect, it, vi } from 'vitest'
import type { EngineContext } from '../../core/types.js'
import { MarketMonitorScanError, type MarketMonitorService } from '../../domain/market-monitor/service.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS, type MarketContextProviderManifest, type MarketMonitorStrategyManifest } from '../../domain/market-monitor/types.js'
import { createMarketMonitorRoutes } from './market-monitor.js'
import { summarizeMonitorHealth } from '../../domain/market-monitor/health.js'
import type { MarketNarratorCoordinator } from '../market-monitor-narrator.js'

function service(): MarketMonitorService {
  return {
    dashboard: vi.fn(async (asset, days = 90) => ({ schemaVersion: 1 as const, asset, generatedAt: '2026-09-18T00:00:00Z', windowDays: days, modules: [] })),
    scanStartedAt: vi.fn(() => null),
    replay: vi.fn(async (snapshotId) => ({ status: 'unavailable' as const, snapshotId })),
    settings: vi.fn(async () => DEFAULT_MARKET_MONITOR_SETTINGS),
    saveSettings: vi.fn(async () => undefined),
    scan: vi.fn(async () => ({ snapshot: {} as never, stored: true, alert: null, receipt: {} as never })),
    isScanning: vi.fn(() => false),
    health: vi.fn(async (asset, hours = 24) => summarizeMonitorHealth(asset, [], hours, new Date('2026-09-13T00:00:00Z'))),
    snapshots: vi.fn(async () => []), alerts: vi.fn(async () => []), receipts: vi.fn(async () => []),
    evaluation: vi.fn(async (asset) => ({ asset, samples: 0, resolved: 0, directionalAccuracy: null, averageForwardChangePercent: null, rows: [] })),
    strategies: vi.fn((): MarketMonitorStrategyManifest[] => [{ id: 'evidence-chain-v1', label: 'Evidence chain', version: 1, description: 'fixture', requiredData: ['daily-bars', 'hourly-bars', 'asset-context'] }]),
    contextProviders: vi.fn((): MarketContextProviderManifest[] => [{ id: 'fixture-context', label: 'Fixture', assets: ['BTC', 'TSLA', 'MSTR'], description: 'fixture' }]),
    review: vi.fn(),
    dailyNarrationInput: vi.fn(async () => ({ generatedAt: new Date().toISOString(), strategyId: 'evidence-chain-v1', assets: [] })),
    publishNarration: vi.fn(),
    narrations: vi.fn(async () => []),
  }
}

describe('market monitor routes', () => {
  it('serves research on the browser-compatible path and keeps the existing alias', async () => {
    const fake = service(), app = createMarketMonitorRoutes({} as EngineContext, fake)
    expect(await (await app.request('/research?asset=BTC&days=30')).json()).toMatchObject({ asset: 'BTC', windowDays: 30 })
    expect((await app.request('/research?asset=BTC&days=999')).status).toBe(400)
    expect((await app.request('/dashboard?asset=MSTR')).status).toBe(200)
    expect(fake.scan).not.toHaveBeenCalled()
  })
  it('reads uncached latest quotes without scanning and rejects unsupported assets', async () => {
    const fake = service(), quotes = { read: vi.fn().mockResolvedValue({ asset: 'BTC', price: 81234, status: 'fresh' }) }
    const app = createMarketMonitorRoutes({} as EngineContext, fake, undefined, undefined, quotes)
    const response = await app.request('/quote?asset=BTC')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ asset: 'BTC', price: 81234 })
    expect((await app.request('/quote?asset=STRC')).status).toBe(400)
    expect(quotes.read).toHaveBeenCalledTimes(1)
    expect(fake.scan).not.toHaveBeenCalled()
    quotes.read.mockRejectedValue(new Error('private details'))
    const failure = await app.request('/quote?asset=BTC')
    expect(failure.status).toBe(503)
    expect(await failure.text()).not.toContain('private details')
  })
  it('validates research windows, leaves scans alone and sanitizes storage failures', async () => {
    const fake = service(), app = createMarketMonitorRoutes({} as EngineContext, fake)
    expect((await app.request('/dashboard?asset=MSTR&days=365')).status).toBe(200)
    expect(fake.dashboard).toHaveBeenCalledWith('MSTR', 365)
    for (const query of ['asset=STRC&days=90', 'asset=BTC&days=7', 'days=30']) expect((await app.request(`/dashboard?${query}`)).status).toBe(400)
    vi.mocked(fake.dashboard).mockRejectedValue(new Error('private path must not escape'))
    const result = await app.request('/dashboard?asset=BTC')
    expect(result.status).toBe(503)
    expect(await result.text()).not.toContain('private path')
    expect(fake.scan).not.toHaveBeenCalled()
  })
  it('validates retrospective windows and does not dispatch scans or leak read errors', async () => {
    const fake = service(), app = createMarketMonitorRoutes({} as EngineContext, fake)
    vi.mocked(fake.review).mockResolvedValue({ policy: 'forward-sessions-v1' } as never)
    expect((await app.request('/review?asset=BTC&days=7')).status).toBe(200)
    expect(fake.review).toHaveBeenCalledWith('BTC', 7)
    expect((await app.request('/review?asset=BTC&days=999')).status).toBe(400)
    expect((await app.request('/review?asset=INVALID')).status).toBe(400)
    vi.mocked(fake.review).mockRejectedValue(new Error('private local path'))
    const failure = await app.request('/review?asset=TSLA')
    expect(failure.status).toBe(503)
    expect(await failure.text()).not.toContain('private local path')
    expect(fake.scan).not.toHaveBeenCalled()
  })

  it('replays only a validated identity without dispatching scans and reports corrupt archives', async () => {
    const fake = service(), app = createMarketMonitorRoutes({} as EngineContext, fake)
    const id = '00000000-0000-4000-8000-000000000001'
    expect((await app.request('/snapshots/invalid/replay')).status).toBe(400)
    expect(await (await app.request(`/snapshots/${id}/replay`)).json()).toEqual({ status: 'unavailable', snapshotId: id })
    vi.mocked(fake.replay).mockRejectedValue(new Error('private filesystem path'))
    const failed = await app.request(`/snapshots/${id}/replay`)
    expect(failed.status).toBe(422)
    expect(await failed.text()).not.toContain('private filesystem path')
    expect(fake.scan).not.toHaveBeenCalled()
  })

  it('returns the failed stage and both source checks with a failed scan', async () => {
    const fake = service()
    const sourceHealth = ['coinbase', 'yfinance'].map(provider => ({ id: 'daily-bars', label: 'Daily OHLCV', provider, status: 'unavailable' as const, asOf: null, detail: 'network unavailable' }))
    vi.mocked(fake.scan).mockRejectedValue(new MarketMonitorScanError({ id: 'test', asset: 'BTC', requestedAt: '2026-09-15T00:00:00Z', trigger: 'manual', outcome: 'failed', error: 'daily-bars: both sources failed', failureStage: 'daily-bars', sourceHealth }))
    const response = await createMarketMonitorRoutes({} as EngineContext, fake).request('/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asset: 'BTC' }) })
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ failureStage: 'daily-bars', sourceHealth })
  })

  it('exposes narrator health, reconciles settings and dispatches an immediate run', async () => {
    const fake = service()
    const status = { enabled: true, state: 'ready' as const, issueId: 'mad42lab-market-daily-interpretation', schedule: { cron: '30 17 * * *', timezone: 'America/Vancouver', localTime: '17:30' }, message: 'ready' }
    const narrator = { status: vi.fn(async () => status), reconcile: vi.fn(async () => status), runNow: vi.fn(async () => status) } satisfies MarketNarratorCoordinator
    const app = createMarketMonitorRoutes({} as EngineContext, fake, undefined, narrator)
    expect((await app.request('/narrator/status')).status).toBe(200)
    expect((await app.request('/narrator/run', { method: 'POST' })).status).toBe(200)
    expect(narrator.runNow).toHaveBeenCalledOnce()
    const saved = await app.request('/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(DEFAULT_MARKET_MONITOR_SETTINGS) })
    expect(saved.status).toBe(200)
    expect(narrator.reconcile).toHaveBeenCalledWith(true)
  })

  it('validates scan identity and preserves trigger provenance', async () => {
    const fake = service()
    const app = createMarketMonitorRoutes({} as EngineContext, fake)
    expect((await app.request('/scan', { method: 'POST', body: JSON.stringify({ asset: 'ETH' }), headers: { 'Content-Type': 'application/json' } })).status).toBe(400)
    expect((await app.request('/scan', { method: 'POST', body: JSON.stringify({ asset: 'BTC', trigger: 'scheduled' }), headers: { 'Content-Type': 'application/json' } })).status).toBe(200)
    expect(fake.scan).toHaveBeenCalledWith('BTC', 'scheduled')
  })

  it('rejects unsafe settings rather than coercing them', async () => {
    const fake = service()
    const app = createMarketMonitorRoutes({} as EngineContext, fake)
    const response = await app.request('/settings', { method: 'PUT', body: JSON.stringify({ ...DEFAULT_MARKET_MONITOR_SETTINGS, intervalMinutes: 0 }), headers: { 'Content-Type': 'application/json' } })
    expect(response.status).toBe(400)
    expect(fake.saveSettings).not.toHaveBeenCalled()
  })

  it('lists modules and rejects an unregistered strategy', async () => {
    const fake = service()
    const app = createMarketMonitorRoutes({} as EngineContext, fake)
    expect((await app.request('/strategies')).status).toBe(200)
    expect((await app.request('/context-providers')).status).toBe(200)
    const response = await app.request('/settings', { method: 'PUT', body: JSON.stringify({ ...DEFAULT_MARKET_MONITOR_SETTINGS, strategyId: 'unknown' }), headers: { 'Content-Type': 'application/json' } })
    expect(response.status).toBe(400)
    expect(fake.saveSettings).not.toHaveBeenCalled()
  })

  it('provides bounded histories and evaluation', async () => {
    const fake = service()
    const app = createMarketMonitorRoutes({} as EngineContext, fake)
    expect((await app.request('/snapshots?asset=TSLA&limit=99999')).status).toBe(200)
    expect(fake.snapshots).toHaveBeenCalledWith('TSLA', 1000, undefined)
    expect((await app.request('/snapshots?asset=BTC&strategyId=evidence-chain-v1')).status).toBe(200)
    expect(fake.snapshots).toHaveBeenCalledWith('BTC', 100, 'evidence-chain-v1')
    expect((await app.request('/evaluation?asset=BTC')).status).toBe(200)
  })

  it('serves a read-only health report with a validated window', async () => {
    const fake = service()
    const app = createMarketMonitorRoutes({} as EngineContext, fake)
    expect((await app.request('/health?asset=BTC&hours=72')).status).toBe(200)
    expect(fake.health).toHaveBeenCalledWith('BTC', 72)
    expect((await app.request('/health?asset=ETH&hours=72')).status).toBe(400)
    expect((await app.request('/health?asset=BTC&hours=999')).status).toBe(400)
    expect(fake.scan).not.toHaveBeenCalled()
  })

  it('reports missing scheduler honestly and exposes an attached runtime', async () => {
    const fake = service()
    expect((await createMarketMonitorRoutes({} as EngineContext, fake).request('/status')).status).toBe(503)
    const { createMarketMonitorScheduler } = await import('../../domain/market-monitor/scheduler.js')
    const scheduler = createMarketMonitorScheduler(fake)
    const app = createMarketMonitorRoutes({} as EngineContext, fake, scheduler)
    expect(await (await app.request('/status')).json()).toMatchObject({ running: false, backgroundEnabled: false, assets: [{ asset: 'BTC' }, { asset: 'TSLA' }, { asset: 'MSTR' }] })
  })

  it('persists explicit background consent and rejects duplicate assets', async () => {
    const fake = service()
    const app = createMarketMonitorRoutes({} as EngineContext, fake)
    const put = (body: unknown) => app.request('/settings', { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
    expect((await put({ ...DEFAULT_MARKET_MONITOR_SETTINGS, backgroundEnabled: true, enabledAssets: ['BTC'] })).status).toBe(200)
    expect(fake.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ backgroundEnabled: true, enabledAssets: ['BTC'] }))
    expect((await put({ ...DEFAULT_MARKET_MONITOR_SETTINGS, enabledAssets: ['BTC', 'BTC'] })).status).toBe(400)
    expect((await put({ ...DEFAULT_MARKET_MONITOR_SETTINGS, backgroundEnabled: 'true' })).status).toBe(400)
  })
})
