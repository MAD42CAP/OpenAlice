import { Hono } from 'hono'
import { z } from 'zod'
import { buildMarketJudgment } from '../../domain/market-monitor/judgment.js'
import type { MarketMonitorService } from '../../domain/market-monitor/service.js'
import type { TypeSafeService } from '../../domain/market-monitor/typesafe-service.js'
import { MARKET_MONITOR_ASSETS } from '../../domain/market-monitor/types.js'

export function createMarketJudgmentRoutes(monitor: Pick<MarketMonitorService, 'settings' | 'snapshots' | 'receipts'>, typeSafe: Pick<TypeSafeService, 'report'>, now = () => new Date()) {
  const app = new Hono()
  app.get('/', async c => {
    c.header('Cache-Control', 'no-store')
    const asset = z.enum(MARKET_MONITOR_ASSETS).safeParse(c.req.query('asset'))
    if (!asset.success) return c.json({ error: 'Select BTC, TSLA or MSTR' }, 400)
    try {
      const settings = await monitor.settings()
      const [snapshots, jev, receipts] = await Promise.all([
        monitor.snapshots(asset.data, 1, settings.strategyId),
        typeSafe.report(asset.data).catch(() => null),
        monitor.receipts(asset.data, 10).catch(() => []),
      ])
      const snapshot = snapshots.at(-1)
      if (!snapshot) return c.json({ error: 'Run a market scan first' }, 404)
      const receipt = receipts.filter(r => r.strategyId === snapshot.strategyId).at(-1)
      return c.json(buildMarketJudgment(snapshot, now(), jev, receipt))
    } catch { return c.json({ error: 'Market judgment could not be loaded' }, 503) }
  })
  return app
}
