import { expect, it, vi } from 'vitest'
import { createMarketMovementAlertsRoutes } from './market-movement-alerts.js'
import { MovementAlertError, type MovementAlertService } from '../../domain/market-monitor/movement-alerts.js'

const id = 'b4f58378-ce4a-4f22-b703-583a7fb25116'
const input = { asset: 'BTC', downPercent: 5, expiresInHours: 24 }
const request = (path: string, body: unknown) => new Request(`http://local${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
it('validates before invoking the service and keeps GET side-effect free', async () => {
  const service = { report: vi.fn(async () => ({ asset: 'BTC', plans: [] })), create: vi.fn(async () => ({ asset: 'BTC' })), cancel: vi.fn(async () => ({ asset: 'BTC' })), check: vi.fn() } as unknown as MovementAlertService
  const app = createMarketMovementAlertsRoutes(service)
  expect((await app.request('/?asset=BTC')).headers.get('Cache-Control')).toBe('no-store')
  expect(service.check).not.toHaveBeenCalled(); expect(service.create).not.toHaveBeenCalled()
  expect((await app.request('/?asset=ETH')).status).toBe(400)
  expect((await app.request(request('/', { ...input, downPercent: 0 }))).status).toBe(400)
  expect((await app.request(request('/', { ...input, unexpected: true }))).status).toBe(400)
  expect((await app.request(request('/', input))).status).toBe(200)
  expect(service.create).toHaveBeenCalledWith(input)
  expect((await app.request(request(`/${id}/cancel`, { asset: 'BTC' }))).status).toBe(200)
  expect(service.cancel).toHaveBeenCalledWith(id, 'BTC')
  expect((await app.request(request('/bad/cancel', { asset: 'BTC' }))).status).toBe(400)
})
it('returns bounded error codes and never private failure details', async () => {
  const service = { create: vi.fn().mockRejectedValueOnce(new MovementAlertError('movement-active-plan')).mockRejectedValueOnce(new Error('private path and credential detail')) } as unknown as MovementAlertService
  const app = createMarketMovementAlertsRoutes(service)
  const conflict = await app.request(request('/', input))
  expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ error: 'movement-active-plan' })
  const failure = await app.request(request('/', input))
  expect(failure.status).toBe(503); expect(await failure.json()).toEqual({ error: 'movement-state-unavailable' })
})
it('rejects oversized bodies before invoking either mutation', async () => {
  const service = { create: vi.fn(), cancel: vi.fn() } as unknown as MovementAlertService
  const app = createMarketMovementAlertsRoutes(service)
  for (const path of ['/', `/${id}/cancel`]) {
    const response = await app.request(request(path, { asset: 'BTC', padding: 'x'.repeat(1024) }))
    expect(response.status).toBe(413)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ error: 'movement-invalid' })
  }
  expect(service.create).not.toHaveBeenCalled(); expect(service.cancel).not.toHaveBeenCalled()
})
