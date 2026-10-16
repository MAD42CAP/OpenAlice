import { Hono } from 'hono'
import { z } from 'zod'
import { MARKET_MONITOR_ASSETS } from '../../domain/market-monitor/types.js'
import { TypeSafeError } from '../../domain/market-monitor/typesafe-client.js'
import type { ForecastValidationService } from '../../domain/market-monitor/forecast-validation.js'
import { FORWARD_PROTOCOL, LEGACY_FORWARD_PROTOCOL, PREVIOUS_FORWARD_PROTOCOL } from '../../domain/market-monitor/forecast-validation-types.js'

export function createForecastValidationRoutes(service: ForecastValidationService, legacy?: Pick<ForecastValidationService, 'report'>, previous?: Pick<ForecastValidationService, 'report'>) {
  const app = new Hono()
  app.use('*', async (c, next) => { c.header('Cache-Control', 'no-store'); await next() })
  app.onError((error, c) => c.json({ error: error instanceof TypeSafeError ? error.message : '新版前向验证暂不可用，原有行情与历史记录不受影响。' }, 502))
  app.get('/', async c => {
    const asset = z.enum(MARKET_MONITOR_ASSETS).safeParse(c.req.query('asset'))
    if (!asset.success) return c.json({ error: 'Select BTC, TSLA or MSTR' }, 400)
    const protocol = c.req.query('protocol') ?? FORWARD_PROTOCOL
    if (![FORWARD_PROTOCOL, LEGACY_FORWARD_PROTOCOL, PREVIOUS_FORWARD_PROTOCOL].some(value => value === protocol)) return c.json({ error: 'Unknown validation protocol' }, 400)
    const selected = protocol === LEGACY_FORWARD_PROTOCOL ? legacy : protocol === PREVIOUS_FORWARD_PROTOCOL ? previous : service
    if (!selected) return c.json({ error: 'Historical validation is unavailable' }, 503)
    return c.json(await selected.report(asset.data))
  })
  app.post('/', async c => {
    if (c.req.query('protocol') && c.req.query('protocol') !== FORWARD_PROTOCOL) return c.json({ error: 'Historical validation is read-only' }, 400)
    const input = z.object({ asset: z.enum(MARKET_MONITOR_ASSETS) }).strict().safeParse(await c.req.json().catch(() => null))
    if (!input.success) return c.json({ error: 'Select BTC, TSLA or MSTR' }, 400)
    const publication = await service.collect(input.data.asset)
    return c.json({ id: publication.id, issuedAt: publication.issuedAt })
  })
  return app
}
