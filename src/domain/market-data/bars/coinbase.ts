import { createPrivateKey, randomBytes, sign } from 'node:crypto'
import type { VendorBarProvider } from './types.js'

export interface CoinbaseMarketDataCredentials {
  keyName?: string
  privateKey?: string
}

export interface CoinbaseMarketDataProviderDeps {
  credentials: () => Promise<CoinbaseMarketDataCredentials> | CoinbaseMarketDataCredentials
  fetcher?: typeof fetch
  baseUrl?: string
  now?: () => Date
}

const MAX_CANDLES = 350
const GRANULARITIES: Record<string, { name: string; seconds: number }> = {
  '1m': { name: 'ONE_MINUTE', seconds: 60 },
  '5m': { name: 'FIVE_MINUTE', seconds: 300 },
  '15m': { name: 'FIFTEEN_MINUTE', seconds: 900 },
  '30m': { name: 'THIRTY_MINUTE', seconds: 1800 },
  '1h': { name: 'ONE_HOUR', seconds: 3600 },
  '4h': { name: 'FOUR_HOUR', seconds: 14400 },
  '1d': { name: 'ONE_DAY', seconds: 86400 },
}

function normalizedCredentials(credentials: CoinbaseMarketDataCredentials): CoinbaseMarketDataCredentials {
  return {
    keyName: credentials.keyName?.trim(),
    privateKey: credentials.privateKey?.trim().replace(/\\n/g, '\n'),
  }
}

function credentialMode(credentials: CoinbaseMarketDataCredentials): 'public' | 'authenticated' {
  const { keyName, privateKey } = normalizedCredentials(credentials)
  if (!keyName && !privateKey) return 'public'
  if (!keyName || !privateKey) {
    throw new Error('Coinbase credentials are incomplete. Add both the CDP API Key Name and ECDSA Private Key, or clear both fields to use public market data.')
  }
  return 'authenticated'
}

function base64url(value: unknown): string {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
}

export function createCoinbaseRestJwt(input: {
  keyName: string
  privateKey: string
  method: 'GET'
  host: string
  path: string
  now?: Date
  nonce?: string
}): string {
  const at = Math.floor((input.now ?? new Date()).getTime() / 1000)
  const header = base64url({ alg: 'ES256', kid: input.keyName, nonce: input.nonce ?? randomBytes(16).toString('hex'), typ: 'JWT' })
  const payload = base64url({
    iss: 'cdp',
    nbf: at,
    exp: at + 120,
    sub: input.keyName,
    uri: `${input.method} ${input.host}${input.path}`,
  })
  const signingInput = `${header}.${payload}`
  let key: ReturnType<typeof createPrivateKey>
  try {
    key = createPrivateKey(input.privateKey)
  } catch {
    throw new Error('Coinbase Private Key is not a valid ECDSA PEM key. Preserve its BEGIN/END lines and line breaks.')
  }
  if (key.asymmetricKeyType !== 'ec') throw new Error('Coinbase App authentication requires an ECDSA/ES256 key, not an Ed25519 key.')
  const signature = sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' })
  return `${signingInput}.${signature.toString('base64url')}`
}

function assertProduct(symbol: string): string {
  const product = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,15}-[A-Z0-9]{2,15}$/.test(product)) throw new Error(`Unsupported Coinbase spot product: ${symbol}`)
  return product
}

function endpointError(status: number, body: string): Error {
  if (status === 401) return new Error('Coinbase rejected the API Key Name or ECDSA Private Key.')
  if (status === 403) return new Error('Coinbase denied this read-only market-data request. Confirm that the key has view permission and any IP allowlist includes this machine.')
  if (status === 429) return new Error('Coinbase market-data rate limit reached; retry after the provider window resets.')
  const safeBody = body.replace(/\s+/g, ' ').trim().slice(0, 180)
  return new Error(`Coinbase Market Data HTTP ${status}${safeBody ? `: ${safeBody}` : ''}`)
}

function requestHeaders(input: {
  credentials: CoinbaseMarketDataCredentials
  method: 'GET'
  host: string
  path: string
  now: Date
}): Record<string, string> {
  const credentials = normalizedCredentials(input.credentials)
  const mode = credentialMode(credentials)
  const headers: Record<string, string> = { Accept: 'application/json', 'Cache-Control': 'no-cache' }
  if (mode === 'authenticated') {
    headers.Authorization = `Bearer ${createCoinbaseRestJwt({
      keyName: credentials.keyName!, privateKey: credentials.privateKey!, method: input.method,
      host: input.host, path: input.path, now: input.now,
    })}`
  }
  return headers
}

function epoch(value: string, end = false): number {
  return Math.floor(Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z`) / 1000)
}

export function createCoinbaseMarketDataProvider(deps: CoinbaseMarketDataProviderDeps): VendorBarProvider {
  const fetcher = deps.fetcher ?? fetch
  const baseUrl = new URL(deps.baseUrl ?? 'https://api.coinbase.com')
  const now = deps.now ?? (() => new Date())
  return {
    id: 'coinbase',
    capability: 'realtime',
    assetClasses: ['crypto'],
    // Coinbase spot market data is publicly available; credentials upgrade the
    // same adapter to the authenticated private-product endpoint.
    isConfigured: () => true,
    async getBars(input) {
      if (input.assetClass !== 'crypto') throw new Error('Coinbase direct market data currently supports spot crypto products only.')
      const granularity = GRANULARITIES[input.interval]
      if (!granularity) throw new Error(`Coinbase does not support interval ${input.interval}`)
      const product = assertProduct(input.symbol)
      const credentials = normalizedCredentials(await deps.credentials())
      const mode = credentialMode(credentials)
      const path = mode === 'authenticated'
        ? `/api/v3/brokerage/products/${encodeURIComponent(product)}/candles`
        : `/api/v3/brokerage/market/products/${encodeURIComponent(product)}/candles`
      const first = epoch(input.start)
      const last = input.end ? epoch(input.end, true) : Math.floor(now().getTime() / 1000)
      const rows = new Map<string, Record<string, unknown>>()
      let cursor = first

      for (let page = 0; cursor <= last && page < 50; page++) {
        const windowEnd = Math.min(last, cursor + granularity.seconds * (MAX_CANDLES - 1))
        const query = new URLSearchParams({
          start: String(cursor), end: String(windowEnd), granularity: granularity.name, limit: String(MAX_CANDLES),
        })
        const headers = requestHeaders({ credentials, method: 'GET', host: baseUrl.host, path, now: now() })
        const response = await fetcher(`${baseUrl.origin}${path}?${query}`, { headers, signal: AbortSignal.timeout(10_000) })
        if (!response.ok) throw endpointError(response.status, await response.text().catch(() => ''))
        const body = await response.json() as {
          candles?: Array<{ start?: unknown; low?: unknown; high?: unknown; open?: unknown; close?: unknown; volume?: unknown }>
        }
        for (const candle of body.candles ?? []) {
          const timestamp = Number(candle.start)
          if (!Number.isFinite(timestamp)) continue
          const instant = new Date(timestamp * 1000).toISOString()
          const date = input.interval === '1d' ? instant.slice(0, 10) : instant
          rows.set(date, { date, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume ?? null })
        }
        if (windowEnd >= last) break
        cursor = windowEnd + granularity.seconds
      }
      return [...rows.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
    },
  }
}

export async function testCoinbaseMarketDataCredentials(
  credentials: CoinbaseMarketDataCredentials,
  fetcher: typeof fetch = fetch,
  base = 'https://api.coinbase.com',
  now = new Date(),
): Promise<'public' | 'authenticated'> {
  const baseUrl = new URL(base)
  const normalized = normalizedCredentials(credentials)
  const mode = credentialMode(normalized)
  const path = mode === 'authenticated'
    ? '/api/v3/brokerage/key_permissions'
    : '/api/v3/brokerage/market/products/BTC-USD'
  const headers = requestHeaders({ credentials: normalized, method: 'GET', host: baseUrl.host, path, now })
  const response = await fetcher(`${baseUrl.origin}${path}`, { headers, signal: AbortSignal.timeout(6_000) })
  if (!response.ok) throw endpointError(response.status, await response.text().catch(() => ''))
  const body = await response.json().catch(() => null)
  if (!body || typeof body !== 'object') throw new Error(`Coinbase ${mode} endpoint returned no usable response.`)
  return mode
}
