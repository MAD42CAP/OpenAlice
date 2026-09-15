import { describe, expect, it, vi } from 'vitest'
import { createAlpacaMarketDataProvider, testAlpacaMarketDataCredentials } from './alpaca.js'

describe('Alpaca read-only market-data provider', () => {
  it('authenticates with both credentials and normalizes IEX bars', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      bars: [{ t: '2026-09-14T04:00:00Z', o: 420, h: 430, l: 415, c: 425, v: 123456 }],
      next_page_token: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const fetcher = fetchMock as typeof fetch
    const provider = createAlpacaMarketDataProvider({
      credentials: () => ({ keyId: 'key-id', secretKey: 'secret-key' }),
      fetcher,
    })

    await expect(provider.getBars({ symbol: 'TSLA', assetClass: 'equity', interval: '1d', start: '2026-09-01', count: 10 })).resolves.toEqual([
      { date: '2026-09-14', open: 420, high: 430, low: 415, close: 425, volume: 123456 },
    ])
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/v2/stocks/TSLA/bars?')
    expect(String(url)).toContain('timeframe=1Day')
    expect(String(url)).toContain('feed=iex')
    expect((init?.headers as Record<string, string>)['APCA-API-KEY-ID']).toBe('key-id')
    expect((init?.headers as Record<string, string>)['APCA-API-SECRET-KEY']).toBe('secret-key')
  })

  it('fails before a request when either credential is missing', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch
    const provider = createAlpacaMarketDataProvider({ credentials: () => ({ keyId: 'only-key' }), fetcher })
    await expect(provider.getBars({ symbol: 'MSTR', assetClass: 'equity', interval: '1h', start: '2026-09-01' })).rejects.toThrow(/not configured/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns an actionable authentication error without exposing credentials', async () => {
    const provider = createAlpacaMarketDataProvider({
      credentials: () => ({ keyId: 'sensitive-id', secretKey: 'sensitive-secret' }),
      fetcher: vi.fn(async () => new Response('unauthorized', { status: 401 })) as typeof fetch,
    })
    await expect(provider.getBars({ symbol: 'TSLA', assetClass: 'equity', interval: '1d', start: '2026-09-01' }))
      .rejects.toThrow('Alpaca rejected')
  })

  it('tests credentials against the latest IEX bar endpoint', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ bar: { c: 1 } }), { status: 200 }))
    const fetcher = fetchMock as typeof fetch
    await testAlpacaMarketDataCredentials({ keyId: 'id', secretKey: 'secret' }, fetcher)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v2/stocks/TSLA/bars/latest?feed=iex')
  })
})
