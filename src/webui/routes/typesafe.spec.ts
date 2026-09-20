import { describe, expect, it, vi } from 'vitest'
import { createTypeSafeRoutes } from './typesafe.js'
import { TypeSafeError } from '../../domain/market-monitor/typesafe-client.js'
import type { TypeSafeService } from '../../domain/market-monitor/typesafe-service.js'
const make = () => ({ settings: vi.fn(async () => ({ configured: false, automatic: false, model: 'jev-1.13.0' })), saveSettings: vi.fn(async () => ({ configured: true, automatic: false, model: 'jev-1.13.0' })), test: vi.fn(async () => ({ model: 'jev-1.13.0', inputTokens: 10 })), report: vi.fn(async () => ({})), generate: vi.fn(async () => ({ id: 'sample', issuedAt: '2026-09-20T00:00:00Z', model: 'jev-1.13.0' })), audit: vi.fn(async () => ({})), automatic: vi.fn() })
describe('TypeSafe routes', () => {
  it('returns no credentials, validates input and never invokes forecasts on reads', async () => {
    const service = make(), app = createTypeSafeRoutes(service as unknown as TypeSafeService)
    const response = await app.request('/settings')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ configured: false, automatic: false, model: 'jev-1.13.0' })
    expect((await app.request('/report?asset=BTC')).status).toBe(200)
    expect(service.generate).not.toHaveBeenCalled()
    expect((await app.request('/report?asset=OTHER')).status).toBe(400)
    expect((await app.request('/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'test-only-placeholder', endpoint: 'https://example.test' }) })).status).toBe(400)
    expect(service.saveSettings).not.toHaveBeenCalled()
  })
  it('maps provider auth failure to 502 without logging out Alice or echoing details', async () => {
    const service = make(), app = createTypeSafeRoutes(service as unknown as TypeSafeService)
    service.test.mockRejectedValueOnce(new TypeSafeError('http-401', 'Key invalid'))
    expect((await app.request('/test', { method: 'POST' })).status).toBe(502)
    service.test.mockRejectedValueOnce(new Error('do-not-echo'))
    expect(await (await app.request('/test', { method: 'POST' })).text()).not.toContain('do-not-echo')
  })
  it('rejects oversized bodies and invalid public source URLs', async () => {
    const service = make(), app = createTypeSafeRoutes(service as unknown as TypeSafeService)
    expect((await app.request('/settings', { method: 'PUT', body: 'x'.repeat(50000) })).status).toBe(413)
    expect((await app.request('/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'A public source excerpt long enough.', claim: 'A claim', sourceUrl: 'file:///private' }) })).status).toBe(400)
    expect(service.audit).not.toHaveBeenCalled()
  })
})
