import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { ResearchLoopService } from '../../domain/market-monitor/research-loop.js'

export function createResearchLoopRoutes(service: Pick<ResearchLoopService, 'report' | 'run'>, equities: Partial<Record<'TSLA' | 'MSTR', Pick<ResearchLoopService, 'report' | 'run'>>> = {}) {
  const app = new Hono()
  app.use('*', bodyLimit({ maxSize: 1000 }))
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.onError((_error, c) => c.json({ error: '研究回流暂不可用；行情扫描和已保存研究仍可使用。' }, 503))
  const select = (asset: string | undefined) => asset === undefined || asset === 'BTC' ? service : asset === 'TSLA' || asset === 'MSTR' ? equities[asset] : undefined
  app.get('/', async c => {
    const selected = select(c.req.query('asset'))
    if (!selected) return c.json({ error: 'Unsupported research asset.' }, 400)
    return c.json(await selected.report())
  })
  app.post('/run', async c => {
    const selected = select(c.req.query('asset'))
    if (!selected || !z.object({}).strict().safeParse(await c.req.json().catch(() => null)).success) return c.json({ error: 'Invalid research request.' }, 400)
    return c.json(await selected.run())
  })
  app.all('*', c => c.json({ error: 'Unknown research feedback endpoint.' }, 404))
  return app
}
