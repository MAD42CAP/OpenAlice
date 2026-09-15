import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EngineContext } from '../../core/types.js'
import { createMarketDataRoutes } from './config.js'

afterEach(() => vi.unstubAllGlobals())

describe('market-data provider credential probes', () => {
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
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ product_id: 'BTC-USD' }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const routes = createMarketDataRoutes({} as EngineContext)
    const response = await routes.request('/test-provider', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'coinbase' }),
    })

    expect(await response.json()).toEqual({ ok: true, mode: 'public' })
    expect(String(fetcher.mock.calls[0][0])).toContain('/market/products/BTC-USD')
  })

  it('tests complete Coinbase CDP credentials against key permissions', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ can_view: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const routes = createMarketDataRoutes({} as EngineContext)
    const response = await routes.request('/test-provider', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'coinbase', key: 'organizations/test/apiKeys/key-id', secret: pem }),
    })

    expect(await response.json()).toEqual({ ok: true, mode: 'authenticated' })
    expect(String(fetcher.mock.calls[0][0])).toContain('/key_permissions')
    expect((fetcher.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toMatch(/^Bearer /)
  })
})
