import { expect, it, vi } from 'vitest'
import { createForecastExperimentRoutes } from './forecast-experiment.js'
import type { ForecastExperimentService } from '../../domain/market-monitor/forecast-experiment.js'

it('keeps report reads free of provider calls, validates assets and hides unexpected errors', async () => {
  const service = { report: vi.fn(async () => ({ asset: 'BTC' })), collect: vi.fn(async () => ({ id: 'frozen', issuedAt: '2026-09-22T12:00:00Z' })) }
  const app = createForecastExperimentRoutes(service as unknown as ForecastExperimentService)
  const read = await app.request('/?asset=BTC')
  expect(read.status).toBe(200); expect(read.headers.get('cache-control')).toBe('no-store')
  expect(service.collect).not.toHaveBeenCalled()
  expect((await app.request('/?asset=OTHER')).status).toBe(400)
  const post = (body: unknown) => app.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  expect((await post({ asset: 'BTC', overwrite: true })).status).toBe(400)
  expect(await (await post({ asset: 'BTC' })).json()).toEqual({ id: 'frozen', issuedAt: '2026-09-22T12:00:00Z' })
  service.report.mockRejectedValueOnce(new Error('private-provider-body'))
  expect(await (await app.request('/?asset=BTC')).text()).not.toContain('private-provider-body')
})
