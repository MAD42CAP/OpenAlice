/** Read-only last trades, independent of candles, accounts and analysis archives. */
export type MarketQuoteAsset = 'BTC' | 'TSLA' | 'MSTR'
type Provider = 'coinbase' | 'alpaca' | 'yfinance'
export type QuoteFailure = 'credentials' | 'unauthorized' | 'forbidden' | 'rate-limit' | 'upstream' | 'timeout' | 'network' | 'invalid-data'
export interface MarketQuote {
  asset: MarketQuoteAsset
  price: number | null
  currency: 'USD'
  asOf: string | null
  fetchedAt: string
  provider: Provider | null
  feed: 'Coinbase Exchange' | 'IEX' | 'Yahoo Finance' | null
  status: 'fresh' | 'delayed' | 'stale' | 'unavailable'
  attempts: Array<{ provider: Provider; failure?: QuoteFailure }>
  illustrative?: boolean
}

class ReadFailure extends Error {
  constructor(readonly reason: QuoteFailure) { super(reason) }
}

interface QuotePayload {
  price?: unknown; time?: unknown; symbol?: unknown
  trade?: { p?: unknown; t?: unknown }
  chart?: { error?: unknown; result?: Array<{ meta?: { symbol?: unknown; currency?: unknown; regularMarketTime?: number; regularMarketPrice?: unknown } }> }
}

export function createMarketQuoteService(options: {
  fetcher?: typeof fetch
  now?: () => Date
  alpacaCredentials?: () => Promise<{ keyId?: string; secretKey?: string }>
} = {}) {
  const fetcher = options.fetcher ?? fetch
  const now = options.now ?? (() => new Date())
  const inFlight = new Map<MarketQuoteAsset, Promise<MarketQuote>>()
  async function json(url: string, headers: Record<string, string> = {}): Promise<QuotePayload | null> {
    // Do not echo bodies, URLs, credentials or raw fetch exceptions into results.
    try {
      const response = await fetcher(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', ...headers }, signal: AbortSignal.timeout(6000), cache: 'no-store' })
      if (!response.ok) throw new ReadFailure(response.status === 401 ? 'unauthorized' : response.status === 403 ? 'forbidden' : response.status === 429 ? 'rate-limit' : 'upstream')
      try { return await response.json() as QuotePayload | null } catch { throw new ReadFailure('invalid-data') }
    } catch (error) {
      if (error instanceof ReadFailure) throw error
      throw new ReadFailure(error instanceof Error && /timeout|abort/i.test(error.name) ? 'timeout' : 'network')
    }
  }
  function valid(price: unknown, timestamp: unknown): { price: number; asOf: string } {
    const numeric = typeof price === 'number' || (typeof price === 'string' && price.trim()) ? Number(price) : NaN
    const time = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN
    if (!Number.isFinite(numeric) || numeric <= 0 || !Number.isFinite(time) || time > now().getTime() + 60_000) throw new ReadFailure('invalid-data')
    return { price: numeric, asOf: new Date(time).toISOString() }
  }
  async function readProvider(asset: MarketQuoteAsset, provider: Provider) {
    if (provider === 'coinbase') {
      const body = await json('https://api.exchange.coinbase.com/products/BTC-USD/ticker')
      return valid(body?.price, body?.time)
    }
    if (provider === 'alpaca') {
      const credentials = await options.alpacaCredentials?.()
      if (!credentials?.keyId?.trim() || !credentials.secretKey?.trim()) throw new ReadFailure('credentials')
      const body = await json(`https://data.alpaca.markets/v2/stocks/${asset}/trades/latest?feed=iex`, { 'APCA-API-KEY-ID': credentials.keyId, 'APCA-API-SECRET-KEY': credentials.secretKey })
      if (body?.symbol !== asset) throw new ReadFailure('invalid-data')
      return valid(body?.trade?.p, body?.trade?.t)
    }
    const symbol = asset === 'BTC' ? 'BTC-USD' : asset
    const body = await json(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`, { 'User-Agent': 'OpenAlice/market-quotes' })
    const meta = body?.chart?.result?.[0]?.meta
    if (body?.chart?.error || meta?.symbol !== symbol || meta.currency !== 'USD' || !Number.isFinite(meta.regularMarketTime)) throw new ReadFailure('invalid-data')
    const stamp = new Date(meta.regularMarketTime! * 1000)
    if (!Number.isFinite(stamp.getTime())) throw new ReadFailure('invalid-data')
    return valid(meta.regularMarketPrice, stamp.toISOString())
  }
  return {
    read(asset: MarketQuoteAsset): Promise<MarketQuote> {
      if (!['BTC', 'TSLA', 'MSTR'].includes(asset)) return Promise.reject(new Error('Unsupported quote asset'))
      const pending = inFlight.get(asset)
      if (pending) return pending
      const task = (async (): Promise<MarketQuote> => {
        const attempts: MarketQuote['attempts'] = []
        for (const provider of [asset === 'BTC' ? 'coinbase' : 'alpaca', 'yfinance'] as Provider[]) {
          try {
            const quote = await readProvider(asset, provider)
            const fetchedAt = now().toISOString()
            const age = Date.parse(fetchedAt) - Date.parse(quote.asOf)
            attempts.push({ provider })
            return { asset, ...quote, currency: 'USD', fetchedAt, provider,
              feed: provider === 'coinbase' ? 'Coinbase Exchange' : provider === 'alpaca' ? 'IEX' : 'Yahoo Finance',
              status: age > (provider === 'yfinance' && asset !== 'BTC' ? 20 * 60_000 : 2 * 60_000) ? 'stale' : provider === 'yfinance' ? 'delayed' : 'fresh', attempts }
          } catch (error) { attempts.push({ provider, failure: error instanceof ReadFailure ? error.reason : 'network' }) }
        }
        return { asset, price: null, currency: 'USD', asOf: null, fetchedAt: now().toISOString(), provider: null, feed: null, status: 'unavailable', attempts }
      })().finally(() => inFlight.delete(asset))
      inFlight.set(asset, task)
      return task
    },
  }
}
