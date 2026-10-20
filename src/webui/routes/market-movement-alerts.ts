import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { MARKET_MONITOR_ASSETS } from '../../domain/market-monitor/types.js'
import { movementCreateSchema, MovementAlertError, type MovementAlertService } from '../../domain/market-monitor/movement-alerts.js'

export function createMarketMovementAlertsRoutes(service: MovementAlertService) {
  const app = new Hono()
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.use('*', bodyLimit({ maxSize: 1024, onError: c => c.json({ error: 'movement-invalid' }, 413) }))
  app.onError((error, c) => {
    const code = error instanceof MovementAlertError ? error.code : 'movement-state-unavailable'
    const status = code === 'movement-invalid' ? 400 : code === 'movement-active-plan' ? 409 : code === 'movement-not-found' ? 404 : 503
    return c.json({ error: code }, status)
  })
  app.get('/', async c => {
    const asset = z.enum(MARKET_MONITOR_ASSETS).safeParse(c.req.query('asset'))
    if (!asset.success) return c.json({ error: 'movement-invalid' }, 400)
    return c.json(await service.report(asset.data))
  })
  app.post('/', async c => {
    const input = movementCreateSchema.safeParse(await c.req.json().catch(() => null))
    if (!input.success) return c.json({ error: 'movement-invalid' }, 400)
    return c.json(await service.create(input.data))
  })
  app.post('/:id/cancel', async c => {
    const id = z.string().uuid().safeParse(c.req.param('id'))
    const input = z.object({ asset: z.enum(MARKET_MONITOR_ASSETS) }).strict().safeParse(await c.req.json().catch(() => null))
    if (!id.success || !input.success) return c.json({ error: 'movement-invalid' }, 400)
    return c.json(await service.cancel(id.data, input.data.asset))
  })
  return app
}
