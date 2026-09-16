import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EngineContext } from '../../core/types.js'
import { createMarketDataRoutes } from './config.js'

afterEach(() => vi.unstubAllGlobals())

function coinbaseResponse(input: string | URL | Request) {
  const url = new URL(String(input))
  return url.pathname.endsWith('/candles') ? { candles: [{ start: url.searchParams.get('start'), open: '100', high: '102', low: '99', close: '101', volume: '2' }] }
    : url.pathname.endsWith('/key_permissions') ? { can_view: true } : { product_id: 'BTC-USD' }
}

describe('market-data provider credential probes', () => {
  it('returns a candle-stage failure even when the permissions probe succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(String(input).includes('/candles') ? { candles: [] } : { can_view: true }))))
    const pem = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    const response = await createMarketDataRoutes({} as EngineContext).request('/test-provider', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'coinbase', key: 'test', secret: pem }),
    })
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining('1d candle test failed') })
  })

  it('tests the paired Alpaca credentials against a read-only IEX endpoint', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ bar: { c: 425 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const routes = createMarketDataRoutes({} as EngineContext)
    const response = await routes.request('/test-provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'alpaca', key: 'key-id', secret: 'secret-key' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toContain('/v2/stocks/TSLA/bars/latest?feed=iex')
    expect((init?.headers as Record<string, string>)['APCA-API-KEY-ID']).toBe('key-id')
    expect((init?.headers as Record<string, string>)['APCA-API-SECRET-KEY']).toBe('secret-key')
  })

  it('reports a missing Alpaca secret without making a network request', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const routes = createMarketDataRoutes({} as EngineContext)
    const response = await routes.request('/test-provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'alpaca', key: 'key-id' }),
    })

    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining('not configured') })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('tests public Coinbase connectivity without requiring a key', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(coinbaseResponse(_input)), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const routes = createMarketDataRoutes({} as EngineContext)
    const response = await routes.request('/test-provider', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'coinbase' }),
    })

    expect(await response.json()).toEqual({ ok: true, mode: 'public', checked: ['BTC-USD 1d candles', 'BTC-USD 1h candles'] })
    expect(String(fetcher.mock.calls[0][0])).toContain('/market/products/BTC-USD')
  })

  it('tests complete Coinbase CDP credentials against permissions and both candle intervals', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(coinbaseResponse(_input)), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const routes = createMarketDataRoutes({} as EngineContext)
    const response = await routes.request('/test-provider', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'coinbase', key: 'organizations/test/apiKeys/key-id', secret: pem }),
    })

    expect(await response.json()).toEqual({ ok: true, mode: 'authenticated', checked: ['BTC-USD 1d candles', 'BTC-USD 1h candles'] })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(String(fetcher.mock.calls[0][0])).toContain('/key_permissions')
    expect((fetcher.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toMatch(/^Bearer /)
  })
})
