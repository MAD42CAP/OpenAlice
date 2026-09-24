import { expect, it, vi } from 'vitest'
import { createMarketThesisRoutes } from './market-thesis.js'
import { ThesisConflict } from '../../domain/market-monitor/thesis-store.js'
import type { ThesisService } from '../../domain/market-monitor/thesis-service.js'

const input = { asset: 'BTC', expectedRevision: 0, draft: { thesis: 'Synthetic thesis', horizon: 'One month', enabled: true, changeNote: 'Initial', conditions: [{ id: 'price', kind: 'support', label: 'Floor', metric: 'daily-close', operator: 'gte', threshold: 100 }] } }
const request = (body: unknown) => new Request('http://local/', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
it('keeps reads side-effect free and validates writes before invoking the service', async () => {
  const service = { report: vi.fn(async () => ({ asset: 'BTC' })), save: vi.fn(async () => ({ asset: 'BTC' })), check: vi.fn(), afterScan: vi.fn() } as unknown as ThesisService
  const app = createMarketThesisRoutes(service)
  expect((await app.request('/?asset=BTC')).headers.get('Cache-Control')).toBe('no-store')
  expect(service.save).not.toHaveBeenCalled(); expect(service.check).not.toHaveBeenCalled()
  expect((await app.request('/?asset=ETH')).status).toBe(400)
  expect((await app.request(request({ ...input, expectedRevision: -1 }))).status).toBe(400)
  expect((await app.request(request({ ...input, unexpected: true }))).status).toBe(400)
  expect((await app.request(request(input))).status).toBe(200)
  expect(service.save).toHaveBeenCalledWith('BTC', 0, input.draft)
})
it('returns conflicts distinctly and never exposes raw failures', async () => {
  const service = { save: vi.fn().mockRejectedValueOnce(new ThesisConflict('private path')).mockRejectedValueOnce(new Error('private transport detail')) } as unknown as ThesisService
  const app = createMarketThesisRoutes(service)
  const conflict = await app.request(request(input)); expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: 'thesis-conflict' })
  const failure = await app.request(request(input)); expect(failure.status).toBe(503); expect(await failure.json()).toEqual({ error: 'thesis-unavailable' })
})
