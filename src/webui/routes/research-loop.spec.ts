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


describe('equity public research feedback routes', () => {
  const post = (body = '{}') => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  it('binds public read and native dispatch to the selected asset, with BTC as the compatible default', async () => {
    const binding = (asset: string) => ({ report: vi.fn(async () => ({ asset })), run: vi.fn(async () => ({ asset })) })
    const btc = binding('BTC'), tsla = binding('TSLA'), mstr = binding('MSTR')
    const app = createResearchLoopRoutes(btc as never, { TSLA: tsla as never, MSTR: mstr as never })
    for (const [asset, service] of [['TSLA', tsla], ['MSTR', mstr]] as const) {
      const read = await app.request(`/?asset=${asset}`)
      expect(read.headers.get('Cache-Control')).toBe('no-store'); expect(await read.json()).toEqual({ asset })
      const run = await app.request(`/run?asset=${asset}`, post())
      expect(run.status).toBe(200); expect(await run.json()).toEqual({ asset })
      expect(service.run).toHaveBeenCalledOnce()
    }
    expect(btc.report).not.toHaveBeenCalled(); expect(btc.run).not.toHaveBeenCalled()
    expect(await (await app.request('/')).json()).toEqual({ asset: 'BTC' })
  })

  it('rejects unbound/unknown asset names and forged publication or identity payloads', async () => {
    const btc = { report: vi.fn(), run: vi.fn() }, stock = { report: vi.fn(), run: vi.fn() }
    const app = createResearchLoopRoutes(btc as never, { TSLA: stock as never })
    for (const asset of ['MSTR', 'AAPL', 'tsla', '', 'toString', '__proto__']) {
      expect(await app.request(`/?asset=${asset}`)).toHaveProperty('status', 400)
      expect(await app.request(`/run?asset=${asset}`, post())).toHaveProperty('status', 400)
    }
    for (const body of ['not json', '{"asset":"BTC"}', '{"runId":"forged"}', '{"feedback":{"summary":"forged"}}']) expect(await app.request('/run?asset=TSLA', post(body))).toHaveProperty('status', 400)
    expect(await app.request('/publish?asset=TSLA', post())).toHaveProperty('status', 404)
    expect(btc.report).not.toHaveBeenCalled(); expect(btc.run).not.toHaveBeenCalled(); expect(stock.report).not.toHaveBeenCalled(); expect(stock.run).not.toHaveBeenCalled()
  })
})
