import { Hono } from 'hono'
import { z } from 'zod'
import type { EngineContext } from '../../core/types.js'
import { createMarketMonitorService, MarketMonitorScanError, type MarketMonitorService } from '../../domain/market-monitor/service.js'
import type { MarketMonitorScheduler } from '../../domain/market-monitor/scheduler.js'
import type { MarketNarratorCoordinator } from '../market-monitor-narrator.js'
import { DEFAULT_MARKET_MONITOR_SETTINGS, MARKET_MONITOR_ASSETS, type MarketMonitorAsset } from '../../domain/market-monitor/types.js'

const assetSchema = z.enum(MARKET_MONITOR_ASSETS)
const settingsSchema = z.object({
  backgroundEnabled: z.boolean().default(false),
  codexNarrationEnabled: z.boolean().default(true),
  enabledAssets: z.array(assetSchema).min(1).max(MARKET_MONITOR_ASSETS.length).refine((assets) => new Set(assets).size === assets.length, 'Assets must be unique'),
  strategyId: z.string().trim().min(1).default(DEFAULT_MARKET_MONITOR_SETTINGS.strategyId),
  intervalMinutes: z.number().int().min(1).max(1440),
  notifications: z.boolean(),
  alertConfidence: z.number().int().min(50).max(95),
  abnormalVolumeRatio: z.number().min(1).max(10),
  abnormalMovePercent: z.number().min(0.1).max(25),
})

function limitFrom(raw: string | undefined): number {
  const value = Number(raw ?? 100)
  return Number.isFinite(value) ? Math.max(1, Math.min(1000, Math.trunc(value))) : 100
}

function assetFrom(raw: string | undefined): MarketMonitorAsset | undefined {
  const parsed = assetSchema.safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

export function createMarketMonitorRoutes(ctx: EngineContext, provided?: MarketMonitorService, scheduler?: MarketMonitorScheduler, narrator?: MarketNarratorCoordinator): Hono {
  const app = new Hono()
  const service = provided ?? createMarketMonitorService({
    barService: ctx.barService,
    equityClient: ctx.equityClient,
    reference: ctx.reference,
    ...(ctx.newsProvider ? { newsProvider: ctx.newsProvider } : {}),
  })

  app.get('/settings', async (c) => c.json(await service.settings()))

  app.get('/status', async (c) => scheduler
    ? c.json(await scheduler.status())
    : c.json({ error: 'Background monitor is not attached to this runtime' }, 503))

  app.get('/strategies', (c) => c.json({ strategies: service.strategies() }))

  app.get('/context-providers', (c) => c.json({ providers: service.contextProviders() }))

  app.put('/settings', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = settingsSchema.safeParse(body)
    if (!parsed.success) return c.json({ error: 'Invalid monitor settings', issues: parsed.error.issues }, 400)
    if (!service.strategies().some((strategy) => strategy.id === parsed.data.strategyId)) {
      return c.json({ error: 'Unknown monitor strategy' }, 400)
    }
    await service.saveSettings(parsed.data)
    await narrator?.reconcile(parsed.data.codexNarrationEnabled)
    return c.json(parsed.data)
  })

  app.get('/narrator/status', async (c) => {
    if (!narrator) return c.json({ error: 'Codex narrator is not attached to this runtime' }, 503)
    return c.json(await narrator.status((await service.settings()).codexNarrationEnabled))
  })

  app.post('/narrator/reconcile', async (c) => {
    if (!narrator) return c.json({ error: 'Codex narrator is not attached to this runtime' }, 503)
    return c.json(await narrator.reconcile((await service.settings()).codexNarrationEnabled))
  })

  app.post('/narrator/run', async (c) => {
    if (!narrator) return c.json({ error: 'Codex narrator is not attached to this runtime' }, 503)
    const settings = await service.settings()
    if (!settings.codexNarrationEnabled) return c.json({ error: 'Codex daily narration is disabled' }, 409)
    const ready = await narrator.reconcile(true)
    if (ready.state === 'blocked' || ready.state === 'failed') return c.json(ready, 409)
    try { return c.json(await narrator.runNow()) }
    catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 409) }
  })

  app.post('/scan', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = z.object({ asset: assetSchema, trigger: z.enum(['manual', 'scheduled']).default('manual') }).safeParse(body)
    if (!parsed.success) return c.json({ error: `asset must be one of: ${MARKET_MONITOR_ASSETS.join(', ')}` }, 400)
    try {
      return c.json(await service.scan(parsed.data.asset, parsed.data.trigger))
    } catch (error) {
      if (error instanceof MarketMonitorScanError) return c.json({ error: error.message, failureStage: error.receipt.failureStage, sourceHealth: error.receipt.sourceHealth }, 502)
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
    }
  })

  app.get('/snapshots', async (c) => {
    const raw = c.req.query('asset')
    const asset = assetFrom(raw)
    if (raw && !asset) return c.json({ error: `asset must be one of: ${MARKET_MONITOR_ASSETS.join(', ')}` }, 400)
    const strategyId = c.req.query('strategyId')
    if (strategyId && !service.strategies().some((strategy) => strategy.id === strategyId)) {
      return c.json({ error: 'Unknown monitor strategy' }, 400)
    }
    const snapshots = await service.snapshots(asset, limitFrom(c.req.query('limit')), strategyId)
    return c.json({ snapshots, count: snapshots.length })
  })

  app.get('/snapshots/:id/replay', async (c) => {
    const parsed = z.string().uuid().safeParse(c.req.param('id'))
    if (!parsed.success) return c.json({ error: 'Invalid observation identity' }, 400)
    try { return c.json(await service.replay(parsed.data)) }
    catch { return c.json({ error: 'Analysis archive could not be verified or read' }, 422) }
  })

  app.get('/alerts', async (c) => {
    const raw = c.req.query('asset')
    const asset = assetFrom(raw)
    if (raw && !asset) return c.json({ error: `asset must be one of: ${MARKET_MONITOR_ASSETS.join(', ')}` }, 400)
    const alerts = await service.alerts(asset, limitFrom(c.req.query('limit')))
    return c.json({ alerts, count: alerts.length })
  })

  app.get('/receipts', async (c) => {
    const raw = c.req.query('asset')
    const asset = assetFrom(raw)
    if (raw && !asset) return c.json({ error: `asset must be one of: ${MARKET_MONITOR_ASSETS.join(', ')}` }, 400)
    const receipts = await service.receipts(asset, limitFrom(c.req.query('limit')))
    return c.json({ receipts, count: receipts.length })
  })

  app.get('/evaluation', async (c) => {
    const asset = assetFrom(c.req.query('asset'))
    if (!asset) return c.json({ error: `asset must be one of: ${MARKET_MONITOR_ASSETS.join(', ')}` }, 400)
    return c.json(await service.evaluation(asset))
  })

  app.get('/review', async (c) => {
    const asset = assetFrom(c.req.query('asset'))
    const days = c.req.query('days') ?? '30'
    if (!asset || !['7', '30', '90'].includes(days)) return c.json({ error: 'Select BTC, TSLA or MSTR and a 7, 30 or 90 day review window' }, 400)
    try { return c.json(await service.review(asset, Number(days) as 7 | 30 | 90)) }
    catch { return c.json({ error: 'Historical review could not be read' }, 503) }
  })

  app.get('/dashboard', async (c) => {
    const asset = assetFrom(c.req.query('asset'))
    const days = c.req.query('days') ?? '90'
    if (!asset || !['30', '90', '365'].includes(days)) return c.json({ error: 'Select BTC, TSLA or MSTR and a 30, 90 or 365 day research window' }, 400)
    try { return c.json(await service.dashboard(asset, Number(days) as 30 | 90 | 365)) }
    catch { return c.json({ error: 'Research history could not be read; existing scans remain available' }, 503) }
  })

  app.get('/health', async (c) => {
    const asset = assetFrom(c.req.query('asset'))
    const hours = c.req.query('hours') ?? '24'
    if (!asset || !['24', '72'].includes(hours)) return c.json({ error: `asset must be one of: ${MARKET_MONITOR_ASSETS.join(', ')}; hours must be 24 or 72` }, 400)
    return c.json(await service.health(asset, Number(hours) as 24 | 72))
  })

  app.get('/defaults', (c) => c.json(DEFAULT_MARKET_MONITOR_SETTINGS))

  return app
}
