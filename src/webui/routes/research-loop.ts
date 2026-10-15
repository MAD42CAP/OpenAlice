import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { ResearchLoopService } from '../../domain/market-monitor/research-loop.js'

export function createResearchLoopRoutes(service: Pick<ResearchLoopService, 'report' | 'run'>) {
  const app = new Hono()
  app.use('*', bodyLimit({ maxSize: 1000 }))
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.onError((_error, c) => c.json({ error: 'BTC 研究回流暂不可用；行情扫描和已保存研究仍可使用。' }, 503))
  app.get('/', async c => {
    if ((c.req.query('asset') ?? 'BTC') !== 'BTC') return c.json({ error: 'Research feedback currently supports BTC only.' }, 400)
    return c.json(await service.report())
  })
  app.post('/run', async c => {
    if (!z.object({}).strict().safeParse(await c.req.json().catch(() => null)).success) return c.json({ error: 'Invalid BTC research request.' }, 400)
    return c.json(await service.run())
  })
  app.all('*', c => c.json({ error: 'Unknown research feedback endpoint.' }, 404))
  return app
}
