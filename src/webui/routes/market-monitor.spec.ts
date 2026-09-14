import { describe, expect, it, vi } from 'vitest'
import type { EngineContext } from '../../core/types.js'
import type { MarketMonitorService } from '../../domain/market-monitor/service.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS, type MarketContextProviderManifest, type MarketMonitorStrategyManifest } from '../../domain/market-monitor/types.js'
import { createMarketMonitorRoutes } from './market-monitor.js'
import { summarizeMonitorHealth } from '../../domain/market-monitor/health.js'
import type { MarketNarratorCoordinator } from '../market-monitor-narrator.js'

function service(): MarketMonitorService {
  return {
    settings: vi.fn(async () => DEFAULT_MARKET_MONITOR_SETTINGS),
    saveSettings: vi.fn(async () => undefined),
    scan: vi.fn(async () => ({ snapshot: {} as never, stored: true, alert: null, receipt: {} as never })),
    isScanning: vi.fn(() => false),
    health: vi.fn(async (asset, hours = 24) => summarizeMonitorHealth(asset, [], hours, new Date('2026-09-13T00:00:00Z'))),
    snapshots: vi.fn(async () => []), alerts: vi.fn(async () => []), receipts: vi.fn(async () => []),
    evaluation: vi.fn(async (asset) => ({ asset, samples: 0, resolved: 0, directionalAccuracy: null, averageForwardChangePercent: null, rows: [] })),
    strategies: vi.fn((): MarketMonitorStrategyManifest[] => [{ id: 'evidence-chain-v1', label: 'Evidence chain', version: 1, description: 'fixture', requiredData: ['daily-bars', 'hourly-bars', 'asset-context'] }]),
    contextProviders: vi.fn((): MarketContextProviderManifest[] => [{ id: 'fixture-context', label: 'Fixture', assets: ['BTC', 'TSLA'], description: 'fixture' }]),
    dailyNarrationInput: vi.fn(async () => ({ generatedAt: new Date().toISOString(), strategyId: 'evidence-chain-v1', assets: [] })),
    publishNarration: vi.fn(),
    narrations: vi.fn(async () => []),
  }
}

describe('market monitor routes', () => {
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
    expect(await (await app.request('/status')).json()).toMatchObject({ running: false, backgroundEnabled: false, assets: [{ asset: 'BTC' }, { asset: 'TSLA' }] })
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
