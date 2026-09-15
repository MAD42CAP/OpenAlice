import type { VendorBarProvider } from './types.js'

export interface AlpacaMarketDataCredentials {
  keyId?: string
  secretKey?: string
}

export interface AlpacaMarketDataProviderDeps {
  credentials: () => Promise<AlpacaMarketDataCredentials> | AlpacaMarketDataCredentials
  fetcher?: typeof fetch
  baseUrl?: string
}

const TIMEFRAMES: Record<string, string> = {
  '1m': '1Min',
  '5m': '5Min',
  '15m': '15Min',
  '30m': '30Min',
  '1h': '1Hour',
  '4h': '4Hour',
  '1d': '1Day',
  '1w': '1Week',
}

function credentialHeaders(credentials: AlpacaMarketDataCredentials): Record<string, string> {
  const keyId = credentials.keyId?.trim()
  const secretKey = credentials.secretKey?.trim()
  if (!keyId || !secretKey) {
    throw new Error('Alpaca Market Data credentials are not configured. Add the Key ID and Secret Key in Settings → Market Data → Advanced.')
  }
  return {
    Accept: 'application/json',
    'APCA-API-KEY-ID': keyId,
    'APCA-API-SECRET-KEY': secretKey,
  }
}

function assertSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9.-]{0,19}$/.test(normalized)) throw new Error(`Unsupported Alpaca equity symbol: ${symbol}`)
  return normalized
}

function endpointError(status: number, body: string): Error {
  if (status === 401) return new Error('Alpaca rejected the Key ID or Secret Key.')
  if (status === 403) return new Error('Alpaca denied this market-data request. Confirm that the key belongs to the selected account and has Basic market-data access.')
  if (status === 429) return new Error('Alpaca market-data rate limit reached; retry after the provider window resets.')
  const safeBody = body.replace(/\s+/g, ' ').trim().slice(0, 180)
  return new Error(`Alpaca Market Data HTTP ${status}${safeBody ? `: ${safeBody}` : ''}`)
}

function dateParam(value: string, end = false): string {
  return `${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`
}

export function createAlpacaMarketDataProvider(deps: AlpacaMarketDataProviderDeps): VendorBarProvider {
  const fetcher = deps.fetcher ?? fetch
  const baseUrl = (deps.baseUrl ?? 'https://data.alpaca.markets').replace(/\/+$/, '')
  return {
    id: 'alpaca',
    capability: 'iex',
    assetClasses: ['equity'],
    async isConfigured() {
      const credentials = await deps.credentials()
      return Boolean(credentials.keyId?.trim() && credentials.secretKey?.trim())
    },
    async getBars(input) {
      if (input.assetClass !== 'equity') throw new Error('Alpaca Market Data direct provider currently supports US equities only.')
      const timeframe = TIMEFRAMES[input.interval]
      if (!timeframe) throw new Error(`Alpaca does not support interval ${input.interval}`)
      const symbol = assertSymbol(input.symbol)
      const headers = credentialHeaders(await deps.credentials())
      const rows: Array<Record<string, unknown>> = []
      let pageToken: string | undefined

      for (let page = 0; page < 10; page++) {
        const query = new URLSearchParams({
          timeframe,
          start: dateParam(input.start),
          adjustment: 'raw',
          feed: 'iex',
          sort: 'asc',
          limit: '10000',
        })
        if (input.end) query.set('end', dateParam(input.end, true))
        if (pageToken) query.set('page_token', pageToken)
        const response = await fetcher(`${baseUrl}/v2/stocks/${encodeURIComponent(symbol)}/bars?${query}`, {
          headers,
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) throw endpointError(response.status, await response.text().catch(() => ''))
        const body = await response.json() as {
          bars?: Array<{ t?: unknown; o?: unknown; h?: unknown; l?: unknown; c?: unknown; v?: unknown }>
          next_page_token?: string | null
        }
        for (const bar of body.bars ?? []) {
          const timestamp = String(bar.t ?? '')
          rows.push({ date: input.interval === '1d' || input.interval === '1w' ? timestamp.slice(0, 10) : timestamp, open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v ?? null })
        }
        pageToken = body.next_page_token || undefined
        if (!pageToken) break
      }
      return rows
    },
  }
}

export async function testAlpacaMarketDataCredentials(
  credentials: AlpacaMarketDataCredentials,
  fetcher: typeof fetch = fetch,
  baseUrl = 'https://data.alpaca.markets',
): Promise<void> {
  const headers = credentialHeaders(credentials)
  const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/v2/stocks/TSLA/bars/latest?feed=iex`, {
    headers,
    signal: AbortSignal.timeout(6_000),
  })
  if (!response.ok) throw endpointError(response.status, await response.text().catch(() => ''))
  const body = await response.json() as { bar?: unknown }
  if (!body.bar) throw new Error('Alpaca authenticated successfully but returned no TSLA latest bar.')
}
