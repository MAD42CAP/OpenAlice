import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createCoinbaseMarketDataProvider, createCoinbaseRestJwt, testCoinbaseMarketDataCredentials } from './coinbase.js'

const now = new Date('2026-09-15T12:00:00Z')
const candle = (start = '1789344000') => ({ start, low: '59000', high: '61000', open: '60000', close: '60500', volume: '123.45' })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
function testKey() {
  return generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
}
function probeFetch(input: string | URL | Request): Response {
  const url = new URL(String(input))
  return json(url.pathname.endsWith('/candles') ? { candles: [candle(url.searchParams.get('start')!)] }
    : url.pathname.endsWith('/key_permissions') ? { can_view: true } : { product_id: 'BTC-USD' })
}

describe('Coinbase read-only market-data provider', () => {
  it('normalizes Coinbase string OHLCV to the numeric BarService contract', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => json({ candles: [candle()] }))
    const provider = createCoinbaseMarketDataProvider({ credentials: () => ({}), fetcher: fetchMock, now: () => now })
    await expect(provider.getBars({ symbol: 'BTC-USD', assetClass: 'crypto', interval: '1d', start: '2026-09-14', end: '2026-09-15' })).resolves.toEqual([
      { date: '2026-09-14', open: 60000, high: 61000, low: 59000, close: 60500, volume: 123.45 },
    ])
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toContain('/api/v3/brokerage/market/products/BTC-USD/candles?')
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
  })

  it('does not turn missing, blank or non-finite prices into zero', async () => {
    const provider = createCoinbaseMarketDataProvider({ credentials: () => ({}), now: () => now,
      fetcher: async () => json({ candles: [{ ...candle(), open: null, high: '', low: 'NaN', close: false, volume: 'Infinity' }] }),
    })
    expect(await provider.getBars({ symbol: 'BTC-USD', assetClass: 'crypto', interval: '1d', start: '2026-09-14' })).toEqual([
      { date: '2026-09-14', open: null, high: null, low: null, close: null, volume: null },
    ])
  })

  it('uses a fresh request-bound ES256 JWT for each authenticated candle page', async () => {
    const privateKey = testKey()
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => json({ candles: [] }))
    const provider = createCoinbaseMarketDataProvider({ credentials: () => ({ keyName: 'organizations/test/apiKeys/key-id', privateKey }), fetcher: fetchMock, now: () => now })
    await provider.getBars({ symbol: 'BTC-USD', assetClass: 'crypto', interval: '1h', start: '2026-08-01', end: '2026-09-15' })
    const nonces = new Set<string>()
    for (const [url, init] of fetchMock.mock.calls) {
      const token = new Headers(init?.headers).get('authorization')!.replace('Bearer ', '')
      const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
      const header = JSON.parse(Buffer.from(encodedHeader!, 'base64url').toString())
      const payload = JSON.parse(Buffer.from(encodedPayload!, 'base64url').toString())
      nonces.add(header.nonce)
      expect(payload.uri).toBe(`GET api.coinbase.com${new URL(String(url)).pathname}`)
      expect(payload.exp - payload.nbf).toBe(120)
      expect(header.alg).toBe('ES256')
      expect(verify('sha256', Buffer.from(`${encodedHeader}.${encodedPayload}`), { key: createPublicKey(privateKey), dsaEncoding: 'ieee-p1363' }, Buffer.from(encodedSignature!, 'base64url'))).toBe(true)
    }
    expect(nonces.size).toBe(fetchMock.mock.calls.length)
  })

  it.each([['1d', 86400], ['1h', 3600]] as const)('pages %s without limit overriding start/end; preserves every boundary', async (interval, seconds) => {
    const first = Date.parse('2025-01-01T00:00:00Z') / 1000
    const last = first + 699 * seconds
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const query = new URL(String(input)).searchParams
      const start = Number(query.get('start')), end = Number(query.get('end'))
      expect(query.has('limit')).toBe(false)
      expect((end - start) / seconds + 1).toBeLessThanOrEqual(350)
      const candles = Array.from({ length: Math.floor((end - start) / seconds) + 1 }, (_, i) => candle(String(start + i * seconds)))
      // Providers may return descending rows, duplicates or a neighbouring bucket.
      return json({ candles: [...candles.reverse(), candles[0], candle(String(start - seconds)), candle(String(end + seconds))] })
    })
    const provider = createCoinbaseMarketDataProvider({ credentials: () => ({}), fetcher: fetchMock, now: () => new Date(last * 1000) })
    const rows = await provider.getBars({ symbol: 'BTC-USD', assetClass: 'crypto', interval, start: '2025-01-01', count: 400 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(rows).toHaveLength(700)
    expect(rows.every((row, i) => Date.parse(String(row.date)) === (first + i * seconds) * 1000)).toBe(true)
  })

  it('fails explicitly instead of silently truncating at 50 pages', async () => {
    const fetcher = vi.fn()
    const provider = createCoinbaseMarketDataProvider({ credentials: () => ({}), fetcher, now: () => now })
    await expect(provider.getBars({ symbol: 'BTC-USD', assetClass: 'crypto', interval: '1m', start: '2025-01-01' })).rejects.toThrow('50-page limit')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a partial key pair before contacting Coinbase', async () => {
    const fetcher = vi.fn()
    const provider = createCoinbaseMarketDataProvider({ credentials: () => ({ keyName: 'only-name' }), fetcher })
    await expect(provider.getBars({ symbol: 'BTC-USD', assetClass: 'crypto', interval: '1d', start: '2026-09-01' })).rejects.toThrow(/incomplete/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects an Ed25519 key with an actionable error', () => {
    const pem = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    expect(() => createCoinbaseRestJwt({ keyName: 'test', privateKey: pem, method: 'GET', host: 'api.coinbase.com', path: '/api/v3/brokerage/key_permissions' })).toThrow(/ECDSA\/ES256/)
  })

  it.each([false, true])('connection test verifies access and usable daily/hourly candles (authenticated=%s)', async (authenticated) => {
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => probeFetch(input))
    const credentials = authenticated ? { keyName: 'organizations/test/apiKeys/key-id', privateKey: testKey() } : {}
    await expect(testCoinbaseMarketDataCredentials(credentials, fetcher, undefined, now)).resolves.toBe(authenticated ? 'authenticated' : 'public')
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(String(fetcher.mock.calls[0]![0])).toContain(authenticated ? '/key_permissions' : '/market/products/BTC-USD')
    expect(fetcher.mock.calls.slice(1).map(([url]) => new URL(String(url)).searchParams.get('granularity'))).toEqual(['ONE_DAY', 'ONE_HOUR'])
  })

  it('rejects an authenticated key without view permission even on HTTP 200', async () => {
    const fetcher = vi.fn(async () => json({ can_view: false }))
    await expect(testCoinbaseMarketDataCredentials({ keyName: 'test', privateKey: testKey() }, fetcher)).rejects.toThrow('view permission')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each(['1d', '1h'])('does not pass connectivity when %s candles are empty', async (interval) => {
    const fetcher = vi.fn(async (input: string | URL | Request) => new URL(String(input)).searchParams.get('granularity') === (interval === '1d' ? 'ONE_DAY' : 'ONE_HOUR') ? json({ candles: [] }) : probeFetch(input))
    await expect(testCoinbaseMarketDataCredentials({}, fetcher, undefined, now)).rejects.toThrow(`${interval} candle test failed: No usable OHLC`)
  })

  it.each([{}, { candles: null }, { candles: 'invalid' }])('rejects malformed response envelopes', async (body) => {
    const provider = createCoinbaseMarketDataProvider({ credentials: () => ({}), fetcher: async () => json(body), now: () => now })
    await expect(provider.getBars({ symbol: 'BTC-USD', assetClass: 'crypto', interval: '1d', start: '2026-09-01' })).rejects.toThrow('missing the candles array')
  })

  it.each([400, 401, 403, 429, 500])('keeps HTTP %s failures actionable without echoing the response body', async (status) => {
    const provider = createCoinbaseMarketDataProvider({ credentials: () => ({}), fetcher: async () => json({ message: 'credential-sentinel' }, status), now: () => now })
    const message = await provider.getBars({ symbol: 'BTC-USD', assetClass: 'crypto', interval: '1d', start: '2026-09-01' }).then(() => '', (error: Error) => error.message)
    expect(message).toContain('Coinbase')
    expect(message).not.toContain('credential-sentinel')
  })

  it('identifies timeouts without echoing request headers', async () => {
    const provider = createCoinbaseMarketDataProvider({ credentials: () => ({}), fetcher: async () => { throw new DOMException('authorization=sentinel', 'TimeoutError') }, now: () => now })
    await expect(provider.getBars({ symbol: 'BTC-USD', assetClass: 'crypto', interval: '1d', start: '2026-09-01' })).rejects.toThrow('timed out')
  })
})
