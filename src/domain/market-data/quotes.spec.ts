import { describe, expect, it, vi } from 'vitest'
import { createMarketQuoteService } from './quotes.js'

const at = new Date('2026-09-18T19:00:00Z')
const now = () => at
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const yahoo = (symbol = 'BTC-USD', price = 81111) => ({ chart: { result: [{ meta: { symbol, currency: 'USD', regularMarketTime: at.getTime() / 1000 - 15, regularMarketPrice: price } }], error: null } })

describe('latest market quotes', () => {
  it('reads a timestamped BTC last trade without credentials or candle requests and refreshes each read', async () => {
    const credentials = vi.fn()
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ price: '81199.23', time: at.toISOString() })).mockResolvedValueOnce(json({ price: '81200.45', time: at.toISOString() }))
    const quotes = createMarketQuoteService({ fetcher, now, alpacaCredentials: credentials })
    expect(await quotes.read('BTC')).toMatchObject({ price: 81199.23, asOf: at.toISOString(), provider: 'coinbase', status: 'fresh' })
    expect((await quotes.read('BTC')).price).toBe(81200.45)
    expect(fetcher.mock.calls.every(([url]) => String(url) === 'https://api.exchange.coinbase.com/products/BTC-USD/ticker')).toBe(true)
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization')
    expect(credentials).not.toHaveBeenCalled()
  })
  it('shares only concurrent requests, not old completed prices', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => json({ price: 10, time: at.toISOString() }))
    const quotes = createMarketQuoteService({ fetcher, now })
    await Promise.all([quotes.read('BTC'), quotes.read('BTC')])
    expect(fetcher).toHaveBeenCalledTimes(1)
    await quotes.read('BTC')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('falls back with source and delay labels, keeping the primary failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({}, 403)).mockResolvedValueOnce(json(yahoo()))
    expect(await createMarketQuoteService({ fetcher, now }).read('BTC')).toMatchObject({ provider: 'yfinance', status: 'delayed', price: 81111, attempts: [{ provider: 'coinbase', failure: 'forbidden' }, { provider: 'yfinance' }] })
  })
  it.each([null, '', 0, -1, 'NaN'])('rejects unusable primary prices (%s)', async price => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ price, time: at.toISOString() })).mockResolvedValueOnce(json(yahoo()))
    expect((await createMarketQuoteService({ fetcher, now }).read('BTC')).attempts[0].failure).toBe('invalid-data')
  })
  it.each([undefined, 'invalid', '2099-01-01T00:00:00Z'])('rejects missing/invalid/future trade time (%s)', async time => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ price: 81000, time })).mockResolvedValueOnce(json(yahoo()))
    expect((await createMarketQuoteService({ fetcher, now }).read('BTC')).provider).toBe('yfinance')
  })
  it('marks old source time as stale even when just fetched', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ price: 81000, time: '2026-09-17T20:00:00Z' }))
    expect(await createMarketQuoteService({ fetcher, now }).read('BTC')).toMatchObject({ status: 'stale', fetchedAt: at.toISOString(), asOf: '2026-09-17T20:00:00.000Z' })
  })
  it('uses only the read-only IEX trade endpoint for configured equities', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ symbol: 'MSTR', trade: { p: 188.1, t: at.toISOString() } }))
    const quote = await createMarketQuoteService({ fetcher, now, alpacaCredentials: async () => ({ keyId: 'fixture-id', secretKey: 'fixture-secret' }) }).read('MSTR')
    expect(quote).toMatchObject({ asset: 'MSTR', price: 188.1, feed: 'IEX', status: 'fresh' })
    expect(fetcher.mock.calls[0][0]).toBe('https://data.alpaca.markets/v2/stocks/MSTR/trades/latest?feed=iex')
    expect(JSON.stringify(quote)).not.toContain('fixture-secret')
  })
  it('falls back on missing credentials and rejects mismatched fallback symbols/currency', async () => {
    const body = yahoo('TSLA'); body.chart.result[0].meta.currency = 'CAD'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(body))
    const quote = await createMarketQuoteService({ fetcher, now }).read('TSLA')
    expect(quote).toMatchObject({ price: null, status: 'unavailable', attempts: [{ provider: 'alpaca', failure: 'credentials' }, { provider: 'yfinance', failure: 'invalid-data' }] })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('preserves both failures without echoing response bodies or network exceptions', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('private-network-details')).mockResolvedValueOnce(json({ message: 'private-response-details' }, 429))
    const quote = await createMarketQuoteService({ fetcher, now }).read('BTC')
    expect(quote).toMatchObject({ price: null, attempts: [{ provider: 'coinbase', failure: 'network' }, { provider: 'yfinance', failure: 'rate-limit' }] })
    expect(JSON.stringify(quote)).not.toContain('private-')
  })
  it('reports request timeout and unusable fallback data separately', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new DOMException('fixture timeout', 'TimeoutError')).mockResolvedValueOnce(json({ chart: { result: [] } }))
    expect(await createMarketQuoteService({ fetcher, now }).read('BTC')).toMatchObject({ status: 'unavailable', attempts: [{ provider: 'coinbase', failure: 'timeout' }, { provider: 'yfinance', failure: 'invalid-data' }] })
  })
})
