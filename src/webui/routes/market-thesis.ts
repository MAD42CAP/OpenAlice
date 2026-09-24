import { Hono } from 'hono'
import { z } from 'zod'
import { MARKET_MONITOR_ASSETS } from '../../domain/market-monitor/types.js'
import { thesisSaveSchema, type ThesisService } from '../../domain/market-monitor/thesis-service.js'
import { ThesisConflict } from '../../domain/market-monitor/thesis-store.js'

export function createMarketThesisRoutes(service: ThesisService) {
  const app = new Hono()
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.onError((error, c) => c.json({ error: error instanceof ThesisConflict ? 'thesis-conflict' : 'thesis-unavailable' }, error instanceof ThesisConflict ? 409 : 503))
  app.get('/', async c => {
    const asset = z.enum(MARKET_MONITOR_ASSETS).safeParse(c.req.query('asset'))
    if (!asset.success) return c.json({ error: 'Invalid asset' }, 400)
    return c.json(await service.report(asset.data))
  })
  app.put('/', async c => {
    const input = thesisSaveSchema.safeParse(await c.req.json().catch(() => null))
    if (!input.success) return c.json({ error: 'thesis-invalid' }, 400)
    return c.json(await service.save(input.data.asset, input.data.expectedRevision, input.data.draft))
  })
  app.post('/check', async c => {
    const input = z.object({ asset: z.enum(MARKET_MONITOR_ASSETS) }).strict().safeParse(await c.req.json().catch(() => null))
    if (!input.success) return c.json({ error: 'Invalid asset' }, 400)
    return c.json(await service.check(input.data.asset))
  })
  return app
}
