import { describe, expect, it, vi } from 'vitest'
import { createDefaultMarketContextProviderRegistry, MarketContextProviderRegistry } from './context.js'
import type { EquityClientLike } from '../market-data/client/types.js'
import type { ReferenceDataService } from '../market-data/reference/types.js'

describe('market context provider registry', () => {
  it('allows multiple independent providers for one asset', () => {
    const providers = [
      { manifest: { id: 'btc-a', label: 'A', assets: ['BTC'] as const, description: 'A' }, load: vi.fn() },
      { manifest: { id: 'btc-b', label: 'B', assets: ['BTC'] as const, description: 'B' }, load: vi.fn() },
    ]
    const registry = new MarketContextProviderRegistry(providers.map((provider) => ({ ...provider, manifest: { ...provider.manifest, assets: [...provider.manifest.assets] } })))
    expect(registry.forAsset('BTC').map((provider) => provider.manifest.id)).toEqual(['btc-a', 'btc-b'])
  })

  it('rejects duplicate module identities and uncovered assets', () => {
    const provider = { manifest: { id: 'same', label: 'Same', assets: ['BTC'] as const, description: 'fixture' }, load: vi.fn() }
    expect(() => new MarketContextProviderRegistry([
      { ...provider, manifest: { ...provider.manifest, assets: [...provider.manifest.assets] } },
      { ...provider, manifest: { ...provider.manifest, assets: [...provider.manifest.assets] } },
    ])).toThrow(/Duplicate market context provider/)
    const registry = new MarketContextProviderRegistry([{ ...provider, manifest: { ...provider.manifest, assets: [...provider.manifest.assets] } }])
    expect(() => registry.forAsset('TSLA')).toThrow(/No market context provider/)
  })

  it('rejects ids that cannot be used as stable module identities', () => {
    expect(() => new MarketContextProviderRegistry([{
      manifest: { id: 'bad/provider', label: 'Bad', assets: ['BTC'], description: 'fixture' },
      load: vi.fn(),
    }])).toThrow(/Invalid market context provider id/)
  })

  it('loads official recent SEC filings for TSLA with attributed links', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain('CIK0001318605.json')
      expect((init?.headers as Record<string, string>)['User-Agent']).toContain('MAD42Lab')
      return new Response(JSON.stringify({ filings: { recent: {
        form: ['8-K', '4', '10-Q'],
        accessionNumber: ['0001318605-26-000001', '0000000000-26-000002', '0001318605-26-000003'],
        filingDate: ['2026-09-10', '2026-09-09', '2026-08-01'],
        reportDate: ['2026-09-10', '', '2026-06-30'],
        primaryDocument: ['tsla-8k.htm', 'form4.xml', 'tsla-10q.htm'],
        primaryDocDescription: ['Current report', 'Insider filing', 'Quarterly report'],
      } } }), { status: 200 })
    }) as typeof fetch
    const registry = createDefaultMarketContextProviderRegistry({
      equityClient: {} as EquityClientLike,
      reference: {} as ReferenceDataService,
      fetcher, secContactEmail: async () => 'monitor@example.test',
    })
    const sec = registry.forAsset('TSLA').find((provider) => provider.manifest.id === 'sec-edgar-equity-v1')!
    const result = await sec.load({ asset: 'TSLA', at: new Date('2026-09-15T00:00:00Z') })
    expect(result.context.recentFilings).toEqual([
      expect.objectContaining({ form: '8-K', filingDate: '2026-09-10', url: expect.stringContaining('/1318605/000131860526000001/tsla-8k.htm') }),
      expect.objectContaining({ form: '10-Q', reportDate: '2026-06-30' }),
    ])
    expect(result.health[0]).toMatchObject({ id: 'tsla-sec-filings', status: 'ok', provider: 'SEC EDGAR' })
  })
})

it.each([
  { error: { code: 10028, message: 'too_many_requests' } },
  { result: [] },
  { result: { unexpected: true } },
])('does not report HTTP 200 as healthy when Deribit rejects or omits market data', async (body) => {
  const registry = createDefaultMarketContextProviderRegistry({ equityClient: {} as EquityClientLike, reference: {} as ReferenceDataService, fetcher: vi.fn(async () => new Response(JSON.stringify(body))) as typeof fetch })
  const result = await registry.forAsset('BTC')[0]!.load({ asset: 'BTC', at: new Date('2026-09-16T00:00:00Z') })
  expect(result.health[0]).toMatchObject({ status: 'unavailable', asOf: null })
  expect(result.health[0]!.detail).toMatch(/futures:.*options:/)
  expect(result.context).toEqual({})
})

it('retains a partial Deribit result and the exact failed side without substituting instantaneous funding', async () => {
  const fetcher = vi.fn(async (url) => new Response(JSON.stringify(String(url).includes('kind=future')
    ? { result: [{ instrument_name: 'BTC-PERPETUAL', open_interest: 1000, current_funding: 0.01 }] }
    : { error: { code: 10028, message: 'too_many_requests' } }))) as typeof fetch
  const registry = createDefaultMarketContextProviderRegistry({ equityClient: {} as EquityClientLike, reference: {} as ReferenceDataService, fetcher })
  const result = await registry.forAsset('BTC')[0]!.load({ asset: 'BTC', at: new Date('2026-09-16T00:00:00Z') })
  expect(result.health[0]).toMatchObject({ status: 'degraded' })
  expect(result.health[0]!.detail).toMatch(/options unavailable.*10028.*too_many_requests/)
  expect(result.context).toMatchObject({ openInterest: 1000, fundingRate: null })
})

it('keeps partial equity failures explicit and separates failed news from a successful empty calendar', async () => {
  const registry = createDefaultMarketContextProviderRegistry({
    equityClient: {
      getKeyMetrics: async () => [{ market_cap: 100 }],
      getEstimateConsensus: async () => { throw new Error('HTTP 403 token=fixture-secret') },
      getShareStatistics: async () => [],
    } as unknown as EquityClientLike,
    reference: { calendar: async () => ({ earnings: [] }) } as unknown as ReferenceDataService,
    newsProvider: { getNewsV2: async () => { throw new Error('HTTP 429') } } as never,
  })
  const source = registry.forAsset('TSLA').find(row => row.manifest.id === 'openalice-equity-v1')!
  const result = await source.load({ asset: 'TSLA', at: new Date('2026-09-17T00:00:00Z') })
  expect(result.health[0]).toMatchObject({ status: 'degraded', failedFields: ['analystTargetMean'] })
  expect(result.health[0]?.detail).toMatch(/metrics: loaded; estimates: HTTP 403; share statistics: no matching data/)
  expect(result.health[1]).toMatchObject({ status: 'degraded', failedFields: ['recentNews'] })
  expect(result.health[1]?.detail).toContain('news: HTTP 429')
  expect(result.context.nextEarningsAt).toBeNull()
  expect(result.context.recentNews).toBeUndefined()
  expect(JSON.stringify(result)).not.toContain('fixture-secret')
})

it('keeps a successful empty news response empty', async () => {
  const registry = createDefaultMarketContextProviderRegistry({
    equityClient: { getKeyMetrics: async () => [], getEstimateConsensus: async () => [], getShareStatistics: async () => [] } as unknown as EquityClientLike,
    reference: { calendar: async () => ({ earnings: [] }) } as unknown as ReferenceDataService,
    newsProvider: { getNewsV2: async () => [] } as never,
  })
  const result = await registry.forAsset('MSTR').find(row => row.manifest.id === 'openalice-equity-v1')!.load({ asset: 'MSTR', at: new Date() })
  expect(result.context.recentNews).toEqual([])
  expect(result.health[1]).toMatchObject({ status: 'ok', failedFields: [] })
  expect(result.health[1]?.detail).toContain('0 recent matching stories')
})
