import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { TypeSafeError } from '../../domain/market-monitor/typesafe-client.js'
import type { TypeSafeService } from '../../domain/market-monitor/typesafe-service.js'
import { MARKET_MONITOR_ASSETS } from '../../domain/market-monitor/types.js'

const assetSchema = z.enum(MARKET_MONITOR_ASSETS)
export function createTypeSafeRoutes(service: TypeSafeService) {
  const app = new Hono()
  app.use('*', bodyLimit({ maxSize: 48_000, onError: c => c.json({ error: 'Request too large' }, 413) }))
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.onError((error, c) => c.json({ error: error instanceof TypeSafeError ? error.message : 'TypeSafe 研究暂不可用，请稍后重试。' }, 502))
  app.get('/settings', async c => c.json(await service.settings()))
  app.put('/settings', async c => {
    const parsed = z.object({ apiKey: z.string().trim().max(4096).optional(), automatic: z.boolean().optional(), clearKey: z.boolean().optional() }).strict().safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Invalid TypeSafe settings' }, 400)
    return c.json(await service.saveSettings(parsed.data))
  })
  app.post('/test', async c => c.json(await service.test()))
  app.get('/report', async c => {
    const asset = assetSchema.safeParse(c.req.query('asset'))
    if (!asset.success) return c.json({ error: 'Select BTC, TSLA or MSTR' }, 400)
    return c.json(await service.report(asset.data))
  })
  app.post('/forecast', async c => {
    const parsed = z.object({ asset: assetSchema }).strict().safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Select BTC, TSLA or MSTR' }, 400)
    const result = await service.generate(parsed.data.asset)
    return c.json({ id: result.id, issuedAt: result.issuedAt, model: result.model })
  })
  app.post('/audit', async c => {
    const parsed = z.object({ source: z.string().trim().min(20).max(16000), claim: z.string().trim().min(3).max(1000),
      sourceUrl: z.string().url().max(2048).refine(url => /^https?:\/\//i.test(url)).optional() }).strict().safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'Provide a public source excerpt (20–16000 characters), a proposition (3–1000 characters), and optionally an HTTP(S) source URL.' }, 400)
    return c.json(await service.audit(parsed.data))
  })
  return app
}
