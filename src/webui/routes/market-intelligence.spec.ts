import { describe, expect, it, vi } from 'vitest'
import type { IntelligenceService } from '../../domain/market-monitor/intelligence-service.js'
import { createMarketIntelligenceRoutes } from './market-intelligence.js'
const fixture = () => {
  const report = { asset: 'BTC', job: { state: 'idle' }, research: { reports: [] } }
  const service = { report: vi.fn(async () => report), discover: vi.fn(async () => report), run: vi.fn(async () => report), importSource: vi.fn(async () => report) } as unknown as IntelligenceService
  return { app: createMarketIntelligenceRoutes(service), service }
}
const post = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
describe('market intelligence routes', () => {
  it('exposes only public report views, with cache disabled', async () => {
    const { app } = fixture(), response = await app.request('/')
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await app.request('/source/private')).toHaveProperty('status', 404)
    expect(await app.request('/publish', post({}))).toHaveProperty('status', 404)
  })
  it('validates operation payloads and returns refreshed reports', async () => {
    const { app, service } = fixture()
    expect((await app.request('/run', post({ force: true }))).status).toBe(200)
    expect(service.run).toHaveBeenCalledWith(true)
    expect((await app.request('/discover', post({ force: 'yes' }))).status).toBe(400)
    expect((await app.request('/import', post({ url: 'https://research.glassnode.com/the-week-onchain-week-41-2026/' }))).status).toBe(200)
    expect((await app.request('/import', post({ url: 'https://research.glassnode.com/', apiKey: 'not-accepted' }))).status).toBe(400)
  })
  it('redacts unexpected transport errors rather than returning exception secrets', async () => {
    const { app, service } = fixture(); vi.mocked(service.run).mockRejectedValue(new Error('token=private-data'))
    const response = await app.request('/run', post({}))
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-data')
  })
})
