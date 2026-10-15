import { describe, expect, it, vi } from 'vitest'
import { createResearchLoopRoutes } from './research-loop.js'

describe('BTC research feedback API boundary', () => {
  it('reads uncached BTC status and explicitly dispatches only through the native runner', async () => {
    const report = { asset: 'BTC', protocol: 'btc-research-loop-v1' }, service = { report: vi.fn(async () => report), run: vi.fn(async () => report) }
    const app = createResearchLoopRoutes(service as never)
    const read = await app.request('/?asset=BTC')
    expect(read.headers.get('Cache-Control')).toBe('no-store')
    expect(await read.json()).toEqual(report)
    expect(service.run).not.toHaveBeenCalled()
    expect((await app.request('/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(200)
    expect(service.run).toHaveBeenCalledOnce()
  })
  it('rejects other assets, forged publication inputs and unknown routes', async () => {
    const service = { report: vi.fn(), run: vi.fn() }, app = createResearchLoopRoutes(service as never)
    expect((await app.request('/?asset=TSLA')).status).toBe(400)
    for (const body of ['not json', '{"asset":"BTC"}', '{"feedback":{"summary":"forged"}}']) expect((await app.request('/run', { method: 'POST', body })).status).toBe(400)
    expect((await app.request('/publish', { method: 'POST', body: '{}' })).status).toBe(404)
    expect(service.run).not.toHaveBeenCalled()
  })
  it('does not expose private source/provider errors', async () => {
    const app = createResearchLoopRoutes({ report: async () => { throw new Error('private-provider-diagnostic') }, run: vi.fn() } as never)
    const response = await app.request('/')
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private-provider-diagnostic')
  })
})
