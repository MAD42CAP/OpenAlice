import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createCoinbaseMarketDataProvider, createCoinbaseRestJwt, testCoinbaseMarketDataCredentials } from './coinbase.js'

function testKey() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
}

describe('Coinbase read-only market-data provider', () => {
  it('loads and normalizes public BTC spot candles without credentials', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      candles: [{ start: '1789344000', low: '59000', high: '61000', open: '60000', close: '60500', volume: '123.45' }],
    }), { status: 200 }))
    const provider = createCoinbaseMarketDataProvider({
      credentials: () => ({}), fetcher: fetchMock as typeof fetch, now: () => new Date('2026-09-15T00:00:00Z'),
    })

    await expect(provider.getBars({ symbol: 'BTC-USD', assetClass: 'crypto', interval: '1d', start: '2026-09-14', end: '2026-09-15' })).resolves.toEqual([
      { date: '2026-09-14', open: '60000', high: '61000', low: '59000', close: '60500', volume: '123.45' },
    ])
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v3/brokerage/market/products/BTC-USD/candles?')
    expect(String(url)).toContain('granularity=ONE_DAY')
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('uses a request-bound ES256 JWT for complete CDP credentials', async () => {
    const privateKey = testKey()
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ candles: [] }), { status: 200 }))
    const provider = createCoinbaseMarketDataProvider({
      credentials: () => ({ keyName: 'organizations/test/apiKeys/key-id', privateKey }),
      fetcher: fetchMock as typeof fetch,
      now: () => new Date('2026-09-15T12:00:00Z'),
    })

    await provider.getBars({ symbol: 'BTC-USD', assetClass: 'crypto', interval: '1h', start: '2026-09-15', end: '2026-09-15' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v3/brokerage/products/BTC-USD/candles?')
    const token = (init?.headers as Record<string, string>).Authorization.replace('Bearer ', '')
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString())
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString())
    expect(header).toMatchObject({ alg: 'ES256', kid: 'organizations/test/apiKeys/key-id' })
    expect(payload).toMatchObject({ iss: 'cdp', sub: 'organizations/test/apiKeys/key-id', uri: 'GET api.coinbase.com/api/v3/brokerage/products/BTC-USD/candles' })
    expect(verify('sha256', Buffer.from(`${encodedHeader}.${encodedPayload}`), { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(encodedSignature, 'base64url'))).toBe(true)
  })

  it('pages long daily windows within Coinbase maximum candle buckets', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ candles: [] }), { status: 200 }))
    const provider = createCoinbaseMarketDataProvider({ credentials: () => ({}), fetcher: fetchMock as typeof fetch })
    await provider.getBars({ symbol: 'BTC-USD', assetClass: 'crypto', interval: '1d', start: '2025-01-01', end: '2026-03-01', count: 400 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url] of fetchMock.mock.calls) expect(String(url)).toContain('limit=350')
  })

  it('rejects a partial key pair before contacting Coinbase', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const provider = createCoinbaseMarketDataProvider({ credentials: () => ({ keyName: 'only-name' }), fetcher })
    await expect(provider.getBars({ symbol: 'BTC-USD', assetClass: 'crypto', interval: '1d', start: '2026-09-01' })).rejects.toThrow(/incomplete/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects an Ed25519 key with an actionable error', () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    expect(() => createCoinbaseRestJwt({
      keyName: 'organizations/test/apiKeys/key-id', privateKey: pem, method: 'GET', host: 'api.coinbase.com', path: '/api/v3/brokerage/key_permissions',
    })).toThrow(/ECDSA\/ES256/)
  })

  it('tests public connectivity or authenticated key permissions according to configuration', async () => {
    const publicFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ product_id: 'BTC-USD' }), { status: 200 }))
    await expect(testCoinbaseMarketDataCredentials({}, publicFetch as typeof fetch)).resolves.toBe('public')
    expect(String(publicFetch.mock.calls[0][0])).toContain('/market/products/BTC-USD')

    const authenticatedFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ can_view: true }), { status: 200 }))
    await expect(testCoinbaseMarketDataCredentials({
      keyName: 'organizations/test/apiKeys/key-id', privateKey: testKey(),
    }, authenticatedFetch as typeof fetch)).resolves.toBe('authenticated')
    expect(String(authenticatedFetch.mock.calls[0][0])).toContain('/key_permissions')
    expect((authenticatedFetch.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toMatch(/^Bearer /)
  })
})
