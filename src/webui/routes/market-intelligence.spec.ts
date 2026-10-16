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


function stockService(asset: 'TSLA' | 'MSTR') {
  const report = { asset, research: { reports: [], snapshots: [], latest: null }, job: { state: 'idle' } }
  return { report: vi.fn(async () => report), run: vi.fn(async () => report), discover: vi.fn(), importSource: vi.fn() } as unknown as IntelligenceService
}
describe('equity public synthesis routes', () => {
  it('selects exactly the requested stock while retaining the BTC default and no-store contract', async () => {
    const { service: btc } = fixture(), tsla = stockService('TSLA'), mstr = stockService('MSTR')
    const app = createMarketIntelligenceRoutes(btc, { TSLA: tsla, MSTR: mstr })
    for (const [asset, service] of [['TSLA', tsla], ['MSTR', mstr]] as const) {
      const response = await app.request(`/?asset=${asset}`)
      expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toMatchObject({ asset, research: { reports: [] } })
      expect(await app.request(`/run?asset=${asset}`, post({ force: false }))).toHaveProperty('status', 200)
      expect(service.run).toHaveBeenCalledWith(false)
    }
    expect(btc.report).not.toHaveBeenCalled(); expect(btc.run).not.toHaveBeenCalled()
    expect(await (await app.request('/')).json()).toMatchObject({ asset: 'BTC' })
  })

  it('rejects stock report imports/discovery, malformed bodies, unknown assets and HTTP publication', async () => {
    const { service: btc } = fixture(), tsla = stockService('TSLA'), mstr = stockService('MSTR'), app = createMarketIntelligenceRoutes(btc, { TSLA: tsla, MSTR: mstr })
    for (const asset of ['TSLA', 'MSTR']) {
      expect(await app.request(`/discover?asset=${asset}`, post({}))).toHaveProperty('status', 400)
      expect(await app.request(`/import?asset=${asset}`, post({ url: 'https://research.glassnode.com/' }))).toHaveProperty('status', 400)
      expect(await app.request(`/run?asset=${asset}`, post({ asset: 'BTC' }))).toHaveProperty('status', 400)
      expect(await app.request(`/publish?asset=${asset}`, post({ draft: {} }))).toHaveProperty('status', 404)
    }
    for (const asset of ['AAPL', 'tsla', '', 'toString', '__proto__']) {
      expect(await app.request(`/?asset=${asset}`)).toHaveProperty('status', 400)
      expect(await app.request(`/run?asset=${asset}`, post({}))).toHaveProperty('status', 400)
    }
    for (const service of [btc, tsla, mstr]) {
      expect(service.run).not.toHaveBeenCalled(); expect(service.discover).not.toHaveBeenCalled(); expect(service.importSource).not.toHaveBeenCalled()
    }
  })
})
