import { safeMarketDataError } from '../market-data/bars/safe-error.js'
import type { EquityClientLike } from '../market-data/client/types.js'
import type { ReferenceDataService } from '../market-data/reference/types.js'
import type { INewsProvider } from '../news/types.js'
import {
  MARKET_MONITOR_ASSET_CONFIG,
  type MarketContext,
  type MarketContextProviderManifest,
  type MarketMonitorAsset,
  type SourceHealth,
} from './types.js'

export type MarketMonitorFetch = typeof fetch

export interface MarketContextProviderResult {
  context: MarketContext
  health: SourceHealth[]
}

export interface MarketContextProvider {
  manifest: MarketContextProviderManifest
  load(input: { asset: MarketMonitorAsset; at: Date }): Promise<MarketContextProviderResult>
}

export interface MarketContextProviderDeps {
  equityClient: EquityClientLike
  reference: ReferenceDataService
  newsProvider?: INewsProvider
  fetcher?: MarketMonitorFetch
}

export class MarketContextProviderRegistry {
  private readonly providers: MarketContextProvider[]
  private readonly byId = new Map<string, MarketContextProvider>()

  constructor(providers: MarketContextProvider[]) {
    this.providers = [...providers]
    for (const provider of providers) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider.manifest.id)) {
        throw new Error(`Invalid market context provider id: ${provider.manifest.id}`)
      }
      if (this.byId.has(provider.manifest.id)) throw new Error(`Duplicate market context provider: ${provider.manifest.id}`)
      this.byId.set(provider.manifest.id, provider)
    }
  }

  forAsset(asset: MarketMonitorAsset): MarketContextProvider[] {
    const providers = this.providers.filter((provider) => provider.manifest.assets.includes(asset))
    if (!providers.length) throw new Error(`No market context provider registered for ${asset}`)
    return providers
  }

  list(): MarketContextProviderManifest[] {
    return this.providers.map(({ manifest }) => ({ ...manifest, assets: [...manifest.assets] }))
  }
}

function numberFrom(row: unknown, keys: string[]): number | null {
  if (!row || typeof row !== 'object') return null
  for (const key of keys) {
    const value = (row as Record<string, unknown>)[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function stringFrom(row: unknown, keys: string[]): string | null {
  if (!row || typeof row !== 'object') return null
  for (const key of keys) {
    const value = (row as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

async function fetchJson(fetcher: MarketMonitorFetch, url: string, headers?: Record<string, string>): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetcher(url, { signal: controller.signal, headers: { Accept: 'application/json', ...headers } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

const SEC_COMPANIES: Record<'TSLA' | 'MSTR', { cik: string; cikPath: string }> = {
  TSLA: { cik: '0001318605', cikPath: '1318605' },
  MSTR: { cik: '0001050446', cikPath: '1050446' },
}

const SEC_FORMS = new Set(['10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A'])

async function secEdgarContext(fetcher: MarketMonitorFetch, asset: 'TSLA' | 'MSTR', at: Date): Promise<MarketContextProviderResult> {
  const company = SEC_COMPANIES[asset]
  try {
    const raw = await fetchJson(
      fetcher,
      `https://data.sec.gov/submissions/CIK${company.cik}.json`,
      { 'User-Agent': 'MAD42Lab Evidence Monitor github.com/MAD42CAP/OpenAlice' },
    ) as { filings?: { recent?: Record<string, unknown> } }
    const recent = raw.filings?.recent ?? {}
    const forms = Array.isArray(recent.form) ? recent.form : []
    const accessionNumbers = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : []
    const filingDates = Array.isArray(recent.filingDate) ? recent.filingDate : []
    const reportDates = Array.isArray(recent.reportDate) ? recent.reportDate : []
    const primaryDocuments = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : []
    const descriptions = Array.isArray(recent.primaryDocDescription) ? recent.primaryDocDescription : []
    const filings: NonNullable<MarketContext['recentFilings']> = []
    for (let index = 0; index < forms.length && filings.length < 6; index++) {
      const form = String(forms[index] ?? '')
      const accession = String(accessionNumbers[index] ?? '')
      const filingDate = String(filingDates[index] ?? '')
      const document = String(primaryDocuments[index] ?? '')
      if (!SEC_FORMS.has(form) || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate) || !document) continue
      const reportDate = String(reportDates[index] ?? '')
      const description = String(descriptions[index] ?? '').trim()
      filings.push({
        form,
        filingDate,
        reportDate: /^\d{4}-\d{2}-\d{2}$/.test(reportDate) ? reportDate : null,
        description: description || null,
        url: `https://www.sec.gov/Archives/edgar/data/${company.cikPath}/${accession.replaceAll('-', '')}/${encodeURIComponent(document)}`,
      })
    }
    return {
      context: { recentFilings: filings },
      health: [{
        id: `${asset.toLowerCase()}-sec-filings`,
        label: `${asset} SEC filings`,
        status: 'ok',
        provider: 'SEC EDGAR',
        asOf: at.toISOString(),
        detail: `${filings.length} recent material filings loaded from the official submissions feed.`,
      }],
    }
  } catch (error) {
    return {
      context: {},
      health: [{
        id: `${asset.toLowerCase()}-sec-filings`,
        label: `${asset} SEC filings`,
        status: 'unavailable',
        provider: 'SEC EDGAR',
        asOf: null,
        detail: safeMarketDataError(error),
      }],
    }
  }
}

async function deribitRows(fetcher: MarketMonitorFetch, kind: 'future' | 'option'): Promise<Array<Record<string, unknown>>> {
  const raw = await fetchJson(fetcher, `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=${kind}`) as { error?: { code?: unknown; message?: unknown }; result?: unknown }
  if (raw?.error) throw new Error(`${kind}: Deribit RPC ${String(raw.error.code ?? 'error')}: ${safeMarketDataError(String(raw.error.message ?? 'request failed'))}`)
  if (!Array.isArray(raw?.result) || !raw.result.length) throw new Error(`${kind}: Deribit returned no usable market data`)
  const rows = raw.result.filter((row): row is Record<string, unknown> => row != null && typeof row === 'object' && typeof row.instrument_name === 'string' && numberFrom(row, ['open_interest']) != null)
  if (!rows.length || (kind === 'future' && !rows.some(row => row.instrument_name === 'BTC-PERPETUAL'))) throw new Error(`${kind}: Deribit response is missing required instruments or open interest`)
  return rows
}

async function bitcoinContext(fetcher: MarketMonitorFetch, at: Date): Promise<MarketContextProviderResult> {
  const capturedAt = at.toISOString()
  try {
    const [futureResult, optionResult] = await Promise.allSettled([
      deribitRows(fetcher, 'future'),
      deribitRows(fetcher, 'option'),
    ])
    if (futureResult.status === 'rejected' && optionResult.status === 'rejected') throw new Error(`futures: ${safeMarketDataError(futureResult.reason)}; options: ${safeMarketDataError(optionResult.reason)}`)
    const futures = futureResult.status === 'fulfilled' ? futureResult.value : []
    const options = optionResult.status === 'fulfilled' ? optionResult.value : []
    const perpetual = futures.find((row) => row.instrument_name === 'BTC-PERPETUAL')
    const dated = futures
      .map((row) => ({ row, expiry: Date.parse(String(row.instrument_name ?? '').split('-').at(-1) ?? '') }))
      .filter(({ expiry }) => Number.isFinite(expiry) && expiry > at.getTime() + 3 * 86400000)
      .sort((a, b) => a.expiry - b.expiry)[0]
    const indexPrice = numberFrom(perpetual, ['underlying_price', 'index_price', 'estimated_delivery_price', 'mark_price'])
    const futurePrice = numberFrom(dated?.row, ['mark_price', 'last'])
    const days = dated ? (dated.expiry - at.getTime()) / 86400000 : null
    const basis = indexPrice && futurePrice && days
      ? ((futurePrice / indexPrice) - 1) * (365 / days) * 100
      : null
    let callOi = 0
    let putOi = 0
    for (const row of options) {
      const oi = numberFrom(row, ['open_interest']) ?? 0
      const name = String(row.instrument_name ?? '')
      if (name.endsWith('-C')) callOi += oi
      else if (name.endsWith('-P')) putOi += oi
    }
    return {
      context: {
        fundingRate: numberFrom(perpetual, ['funding_8h']),
        openInterest: numberFrom(perpetual, ['open_interest']),
        annualizedBasisPercent: basis == null ? null : Number(basis.toFixed(2)),
        optionOpenInterest: callOi + putOi || null,
        putCallOpenInterestRatio: callOi > 0 ? Number((putOi / callOi).toFixed(2)) : null,
      },
      health: [{ id: 'btc-derivatives', label: 'BTC derivatives context', status: futureResult.status === 'fulfilled' && optionResult.status === 'fulfilled' ? 'ok' : 'degraded', provider: 'Deribit public API', asOf: capturedAt, detail: `Read-only derivatives context loaded${futureResult.status === 'rejected' ? `; futures unavailable (${safeMarketDataError(futureResult.reason)})` : ''}${optionResult.status === 'rejected' ? `; options unavailable (${safeMarketDataError(optionResult.reason)})` : ''}.` }],
    }
  } catch (error) {
    return {
      context: {},
      health: [{ id: 'btc-derivatives', label: 'BTC derivatives context', status: 'unavailable', provider: 'Deribit public API', asOf: null, detail: safeMarketDataError(error) }],
    }
  }
}

const EQUITY_NEWS_ALIASES: Record<'TSLA' | 'MSTR', string[]> = {
  TSLA: ['TSLA', 'Tesla'],
  MSTR: ['MSTR', 'MicroStrategy', 'Strategy Inc'],
}

async function equityContext(
  deps: Pick<MarketContextProviderDeps, 'equityClient' | 'reference' | 'newsProvider'>,
  asset: 'TSLA' | 'MSTR',
  at: Date,
): Promise<MarketContextProviderResult> {
  const symbol = MARKET_MONITOR_ASSET_CONFIG[asset].symbol
  const sourceId = asset.toLowerCase()
  const [metrics, estimates, shares, calendar, news] = await Promise.allSettled([
    deps.equityClient.getKeyMetrics({ symbol }),
    deps.equityClient.getEstimateConsensus({ symbol }),
    deps.equityClient.getShareStatistics({ symbol }),
    deps.reference.calendar({ days: 90 }),
    deps.newsProvider?.getNewsV2({ endTime: at, lookback: '7d', limit: 100 }) ?? Promise.resolve([]),
  ])
  const metric = metrics.status === 'fulfilled' ? metrics.value[0] : undefined
  const estimate = estimates.status === 'fulfilled' ? estimates.value[0] : undefined
  const share = shares.status === 'fulfilled' ? shares.value[0] : undefined
  const earnings = calendar.status === 'fulfilled'
    ? calendar.value.earnings.find((row) => String((row as { symbol?: unknown }).symbol ?? '').toUpperCase() === symbol)
    : undefined
  const newsRows = news.status === 'fulfilled' ? news.value.filter((item) => {
    const text = `${item.title}\n${item.content}`.toLowerCase()
    return EQUITY_NEWS_ALIASES[asset].some((alias) => text.includes(alias.toLowerCase()))
  }).slice(-5).reverse() : []
  const context: MarketContext = {
    marketCap: numberFrom(metric, ['market_cap']),
    trailingPe: numberFrom(metric, ['price_to_earnings', 'pe_ratio']),
    forwardPe: numberFrom(metric, ['forward_pe', 'pe_forward']),
    analystTargetMean: numberFrom(estimate, ['target_consensus', 'target_mean', 'target_price']),
    shortPercentFloat: numberFrom(share, ['short_percent_of_float']),
    nextEarningsAt: stringFrom(earnings, ['report_date', 'date']),
    recentNews: newsRows.map((item) => ({ title: item.title, time: item.time.toISOString(), source: item.metadata.source ?? null })),
  }
  const coreOk = [context.marketCap, context.trailingPe, context.forwardPe, context.analystTargetMean, context.shortPercentFloat].some((value) => value != null)
  const calendarOk = calendar.status === 'fulfilled'
  const newsOk = Boolean(deps.newsProvider && news.status === 'fulfilled')
  return { context, health: [
    { id: `${sourceId}-reference`, label: `${asset} fundamentals and positioning`, status: coreOk ? 'ok' : 'unavailable', provider: 'OpenAlice equity providers', asOf: coreOk ? at.toISOString() : null, detail: coreOk ? 'Valuation, analyst and short-interest fields loaded where supported.' : 'Configured equity providers returned no usable context.' },
    { id: `${sourceId}-calendar-news`, label: `${asset} calendar and news`, status: calendarOk && newsOk ? 'ok' : calendarOk || newsOk ? 'degraded' : 'unavailable', provider: 'OpenAlice reference/news', asOf: calendarOk || newsOk ? at.toISOString() : null, detail: `${context.nextEarningsAt ? 'Earnings date available' : 'No earnings date'}; ${context.recentNews?.length ?? 0} recent matching stories${!deps.newsProvider ? '; news collector not configured' : ''}.` },
  ] }
}

export function createDefaultMarketContextProviderRegistry(deps: MarketContextProviderDeps): MarketContextProviderRegistry {
  const fetcher = deps.fetcher ?? fetch
  return new MarketContextProviderRegistry([
    {
      manifest: { id: 'deribit-btc-v1', label: 'BTC derivatives', assets: ['BTC'], description: 'Deribit public futures, perpetual and options summaries.' },
      load: ({ at }) => bitcoinContext(fetcher, at),
    },
    {
      manifest: { id: 'openalice-equity-v1', label: 'Equity reference', assets: ['TSLA', 'MSTR'], description: 'Configured OpenAlice fundamentals, estimates, calendar and news providers.' },
      load: ({ asset, at }) => {
        if (asset !== 'TSLA' && asset !== 'MSTR') throw new Error(`Unsupported equity context asset: ${asset}`)
        return equityContext(deps, asset, at)
      },
    },
    {
      manifest: { id: 'sec-edgar-equity-v1', label: 'SEC EDGAR filings', assets: ['TSLA', 'MSTR'], description: 'Official SEC submissions for recent 10-K, 10-Q and 8-K evidence.' },
      load: ({ asset, at }) => {
        if (asset !== 'TSLA' && asset !== 'MSTR') throw new Error(`Unsupported SEC filing asset: ${asset}`)
        return secEdgarContext(fetcher, asset, at)
      },
    },
  ])
}
