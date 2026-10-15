import { expect, it, vi } from 'vitest'
import { createForecastValidationRoutes } from './forecast-validation.js'
import type { ForecastValidationService } from '../../domain/market-monitor/forecast-validation.js'
import { TypeSafeError } from '../../domain/market-monitor/typesafe-client.js'

it('keeps report reads side-effect free, validates requests, disables caching and hides unexpected details', async () => {
  const service = { report: vi.fn(async () => ({ asset: 'BTC', protocol: 'market-forward-v2' })), collect: vi.fn(async () => ({ id: 'frozen-v2', issuedAt: '2026-10-15T20:00:00Z' })) }
  const app = createForecastValidationRoutes(service as unknown as ForecastValidationService)
  const read = await app.request('/?asset=BTC')
  expect(read.status).toBe(200); expect(read.headers.get('cache-control')).toBe('no-store')
  expect(service.collect).not.toHaveBeenCalled()
  expect((await app.request('/?asset=OTHER')).status).toBe(400)
  const post = (body: unknown) => app.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  expect((await post({ asset: 'BTC', overwrite: true })).status).toBe(400)
  expect((await post({})).status).toBe(400)
  expect(await (await post({ asset: 'BTC' })).json()).toEqual({ id: 'frozen-v2', issuedAt: '2026-10-15T20:00:00Z' })
  service.report.mockRejectedValueOnce(new Error('private-provider-body'))
  const failed = await app.request('/?asset=BTC')
  expect(failed.status).toBe(502); expect(failed.headers.get('cache-control')).toBe('no-store')
  expect(await failed.text()).not.toContain('private-provider-body')
  service.collect.mockRejectedValueOnce(new TypeSafeError('session', '模型请求跨越交易日期。'))
  expect(await (await post({ asset: 'BTC' })).json()).toEqual({ error: '模型请求跨越交易日期。' })
})
