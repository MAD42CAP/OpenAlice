import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { IntelligenceService } from '../../domain/market-monitor/intelligence-service.js'

export function createMarketIntelligenceRoutes(service: IntelligenceService) {
  const app = new Hono()
  app.use('*', bodyLimit({ maxSize: 300_000 }))
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.onError((error, c) => c.json({ error: /^(?:Glassnode|Only an official|Manual research)/.test(error.message) ? error.message.slice(0, 240) : '研究暂不可用，原有市场监测仍可使用。' }, 503))
  app.get('/', async c => c.json(await service.report()))
  const force = z.object({ force: z.boolean().optional() }).strict()
  app.post('/discover', async c => {
    const input = force.safeParse(await c.req.json().catch(() => null))
    if (!input.success) return c.json({ error: 'Invalid discovery request' }, 400)
    return c.json(await service.discover(input.data.force))
  })
  app.post('/run', async c => {
    const input = force.safeParse(await c.req.json().catch(() => null))
    if (!input.success) return c.json({ error: 'Invalid research request' }, 400)
    return c.json(await service.run(input.data.force ?? true))
  })
  app.post('/import', async c => {
    const input = z.object({ url: z.string().url().max(1000), title: z.string().max(300).optional(), text: z.string().max(250_000).optional(), publishedAt: z.string().datetime({ offset: true }).nullable().optional() }).strict().safeParse(await c.req.json().catch(() => null))
    if (!input.success) return c.json({ error: 'Invalid report import' }, 400)
    return c.json(await service.importSource(input.data))
  })
  // Keep unknown API paths out of the application's SPA HTML fallback.
  app.all('*', c => c.json({ error: 'Unknown intelligence endpoint' }, 404))
  return app
}
