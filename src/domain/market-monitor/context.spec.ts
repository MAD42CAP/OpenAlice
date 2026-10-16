import { describe, expect, it, vi } from 'vitest'
import { createDefaultMarketContextProviderRegistry, MarketContextProviderRegistry } from './context.js'
import type { EquityClientLike } from '../market-data/client/types.js'
import type { ReferenceDataService } from '../market-data/reference/types.js'
import type { OfficialEarningsResult } from './official-earnings.js'
import { currentOfficialEarnings } from './earnings-evidence.js'
import { SecEarningsError } from './sec-earnings.js'
import { judgmentSnapshot } from './judgment.fixture.js'


function officialEvent(asset: 'TSLA' | 'MSTR', at: Date, overrides: Partial<OfficialEarningsResult> = {}): OfficialEarningsResult {
  return { asset, status: 'unannounced', date: null, timing: 'unknown', webcastAt: null,
    sourceUrl: asset === 'TSLA' ? 'https://ir.tesla.com/press-release/tesla-quarterly-results-date' : 'https://www.strategy.com/press/financial-results-date',
    title: 'Official financial events', publishedAt: null, retrievedAt: at.toISOString(), contentHash: 'a'.repeat(64),
    verification: 'live-official', detail: 'Verified official calendar with no upcoming earnings announcement.', ...overrides }
}
const noAnnouncement = async (asset: 'TSLA' | 'MSTR', at: Date) => officialEvent(asset, at)

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
    officialEarningsReader: noAnnouncement,
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
    officialEarningsReader: noAnnouncement,
    equityClient: { getKeyMetrics: async () => [], getEstimateConsensus: async () => [], getShareStatistics: async () => [] } as unknown as EquityClientLike,
    reference: { calendar: async () => ({ earnings: [] }) } as unknown as ReferenceDataService,
    newsProvider: { getNewsV2: async () => [] } as never,
  })
  const result = await registry.forAsset('MSTR').find(row => row.manifest.id === 'openalice-equity-v1')!.load({ asset: 'MSTR', at: new Date() })
  expect(result.context.recentNews).toEqual([])
  expect(result.health[1]).toMatchObject({ status: 'ok', failedFields: [], coverage: { earnings: 'unknown', news: 'empty' } })
  expect(result.health[1]?.detail).toContain('0 recent matching stories')
})

it('selects the earliest valid upcoming earnings date, ignoring stale dates and other symbols', async () => {
  const registry = createDefaultMarketContextProviderRegistry({
    officialEarningsReader: noAnnouncement,
    equityClient: { getKeyMetrics: async () => [], getEstimateConsensus: async () => [], getShareStatistics: async () => [] } as unknown as EquityClientLike,
    reference: { calendar: async () => ({ earnings: [
      { symbol: 'TSLA', report_date: '2026-09-01' }, { symbol: 'TSLA', report_date: 'unknown' }, { symbol: 'TSLA', report_date: '2027-02-30' },
      { symbol: 'MSTR', report_date: '2026-10-01' }, { symbol: 'TSLA', report_date: '2026-11-01' }, { symbol: 'TSLA', report_date: '2026-10-20' },
    ] }) } as unknown as ReferenceDataService,
    newsProvider: { getNewsV2: async () => [] } as never,
  })
  const result = await registry.forAsset('TSLA').find(p => p.manifest.id === 'openalice-equity-v1')!.load({ asset: 'TSLA', at: new Date('2026-10-07T12:00:00Z') })
  expect(result.context.nextEarningsAt).toBeNull()
  expect(result.context.earningsEvent).toMatchObject({ status: 'unannounced', referenceDate: '2026-10-20' })
  expect(result.health[1]).toMatchObject({ status: 'ok', coverage: { earnings: 'unknown', news: 'empty' } })
})


async function earningsContext(options: {
  official?: (asset: 'TSLA' | 'MSTR', at: Date) => Promise<OfficialEarningsResult>
  calendar?: Record<string, unknown>
  news?: () => Promise<unknown[]>
  asset?: 'TSLA' | 'MSTR'
  at?: Date
} = {}) {
  const at = options.at ?? new Date('2026-10-07T12:00:00Z'), asset = options.asset ?? 'TSLA'
  const registry = createDefaultMarketContextProviderRegistry({
    equityClient: { getKeyMetrics: async () => [{ market_cap: 1000 }], getEstimateConsensus: async () => [], getShareStatistics: async () => [] } as unknown as EquityClientLike,
    reference: { calendar: async () => options.calendar ?? { earnings: [], meta: { provider: 'fmp', asOf: at.toISOString() } } } as unknown as ReferenceDataService,
    newsProvider: { getNewsV2: options.news ?? (async () => []) } as never,
    officialEarningsReader: options.official ?? noAnnouncement,
  })
  return registry.forAsset(asset).find(provider => provider.manifest.id === 'openalice-equity-v1')!.load({ asset, at })
}

describe('independent official earnings context', () => {
  it('prefers a current official announcement over a differing provider estimate and retains precise provenance', async () => {
    const result = await earningsContext({
      official: async (asset, at) => officialEvent(asset, at, { status: 'confirmed', date: '2026-10-21', timing: 'after-close', webcastAt: '2026-10-21T21:30:00Z', publishedAt: '2026-10-01T12:00:00Z' }),
      calendar: { earnings: [{ symbol: 'TSLA', report_date: '2026-10-20' }], meta: { provider: 'fmp', asOf: '2026-10-07T12:00:00Z' } },
    })
    expect(result.context.nextEarningsAt).toBe('2026-10-21')
    expect(result.context.earningsEvent).toMatchObject({ status: 'confirmed', date: '2026-10-21', referenceDate: '2026-10-20', referenceSource: 'fmp', timing: 'after-close', webcastAt: '2026-10-21T21:30:00Z', verification: 'live-official' })
    expect(result.health.find(source => source.id === 'tsla-earnings')).toMatchObject({ status: 'ok', provider: 'Tesla Investor Relations', asOf: '2026-10-07T12:00:00.000Z', failedFields: [] })
    expect(result.health[1]?.detail).toContain('official announcement takes precedence')
    const snapshot = { ...judgmentSnapshot(), asset: 'TSLA' as const, capturedAt: '2026-10-07T12:00:00Z', context: result.context, sourceHealth: result.health }
    expect(currentOfficialEarnings(snapshot, new Date(snapshot.capturedAt))?.date).toBe('2026-10-21')
  })

  it('keeps a generic date explicitly estimated after an official failure and never enables confirmation', async () => {
    const result = await earningsContext({
      official: async () => { throw new Error('HTTP 403 token=syntheticSecretShouldNeverPersist') },
      calendar: { earnings: [{ symbol: 'TSLA', report_date: '2026-10-20' }], meta: { provider: 'fmp', asOf: '2026-10-07T12:00:00Z' } },
    })
    expect(result.context.nextEarningsAt).toBeNull()
    expect(result.context.earningsEvent).toMatchObject({ status: 'estimated', date: '2026-10-20', verification: null, sourceUrl: null })
    expect(result.health[1]).toMatchObject({ status: 'ok', coverage: { earnings: 'unknown', news: 'empty' } })
    expect(result.health.find(source => source.id === 'tsla-earnings')).toMatchObject({ status: 'degraded', asOf: null, failedFields: ['nextEarningsAt', 'earningsEvent'] })
    expect(JSON.stringify(result)).not.toContain('syntheticSecretShouldNeverPersist')
  })

  it('keeps a successfully empty generic calendar unknown while an official request fails independently', async () => {
    const result = await earningsContext({ official: async () => { throw new Error('HTTP 403') } })
    expect(result.health[1]).toMatchObject({ status: 'ok', coverage: { earnings: 'unknown', news: 'empty' } })
    expect(result.health.find(source => source.id === 'tsla-earnings')).toMatchObject({ status: 'unavailable' })
    expect(result.context.earningsEvent?.status).toBe('unavailable')
  })

  it.each(['partial-error', 'stale-cache', 'old-time', 'future-time'] as const)('rejects an exposed %s reference calendar instead of using its rows', async failure => {
    const calendar = { earnings: [{ symbol: 'TSLA', report_date: '2026-10-20' }], errors: failure === 'partial-error' ? { earnings: 'HTTP 429 token=syntheticReferenceSecret' } : {}, meta: { provider: 'fmp', asOf: failure === 'old-time' ? '2026-10-01T00:00:00Z' : failure === 'future-time' ? '2026-10-08T00:00:00Z' : '2026-10-07T12:00:00Z', stale: failure === 'stale-cache' } }
    const result = await earningsContext({ calendar, official: async () => { throw new Error('HTTP 403') } })
    expect(result.context.nextEarningsAt).toBeNull()
    expect(result.context.earningsEvent).toMatchObject({ status: 'unavailable', referenceDate: null })
    expect(result.health[1]?.coverage?.earnings).toBe('unavailable')
    expect(JSON.stringify(result)).not.toContain('syntheticReferenceSecret')
  })

  it('does not let failed news invalidate an independently verified official date or renew its cached acquisition time', async () => {
    const result = await earningsContext({
      official: async (asset, at) => officialEvent(asset, at, { status: 'confirmed', date: '2026-10-21', publishedAt: '2026-10-01', retrievedAt: '2026-10-07T09:00:00Z', verification: 'research-reviewed' }),
      news: async () => { throw new Error('HTTP 503') },
    })
    expect(result.context.nextEarningsAt).toBe('2026-10-21')
    expect(result.health[1]).toMatchObject({ status: 'degraded', failedFields: ['recentNews'], coverage: { earnings: 'available', news: 'unavailable' } })
    expect(result.health.find(source => source.id === 'tsla-earnings')).toMatchObject({ status: 'ok', asOf: '2026-10-07T09:00:00Z', failedFields: [] })
    expect(result.context.earningsEvent?.retrievedAt).toBe('2026-10-07T09:00:00Z')
    const snapshot = { ...judgmentSnapshot(), asset: 'TSLA' as const, capturedAt: '2026-10-07T12:00:00Z', context: result.context, sourceHealth: result.health }
    expect(currentOfficialEarnings(snapshot, new Date(snapshot.capturedAt))?.date).toBe('2026-10-21')
  })

  it('does not replace conflicting official announcements with a generic estimate', async () => {
    const result = await earningsContext({
      official: async (asset, at) => officialEvent(asset, at, { status: 'conflict', detail: 'Two current official announcements disagree.' }),
      calendar: { earnings: [{ symbol: 'TSLA', report_date: '2026-10-20' }], meta: { provider: 'fmp', asOf: '2026-10-07T12:00:00Z' } },
    })
    expect(result.context.nextEarningsAt).toBeNull()
    expect(result.context.earningsEvent).toMatchObject({ status: 'conflict', date: null, referenceDate: '2026-10-20' })
    expect(result.health.find(source => source.id === 'tsla-earnings')).toMatchObject({ status: 'degraded', failedFields: [] })
  })

  it.each(['future-acquisition', 'old-acquisition', 'future-publication', 'past-date', 'wrong-asset'] as const)('rejects %s official provenance', async failure => {
    const result = await earningsContext({ official: async (asset, at) => officialEvent(asset, at, {
      status: 'confirmed', date: failure === 'past-date' ? '2026-10-06' : '2026-10-21',
      retrievedAt: failure === 'future-acquisition' ? '2026-10-08T00:00:00Z' : failure === 'old-acquisition' ? '2026-10-01T00:00:00Z' : at.toISOString(),
      publishedAt: failure === 'future-publication' ? '2026-10-08T00:00:00Z' : null,
      asset: failure === 'wrong-asset' ? 'MSTR' : asset,
    }) })
    expect(result.context.nextEarningsAt).toBeNull()
    expect(result.context.earningsEvent?.status).toBe('unavailable')
    expect(result.health.find(source => source.id === 'tsla-earnings')?.status).toBe('unavailable')
  })
})

it('attributes a current SEC earnings exhibit correctly through context and the judgment guard', async () => {
  const sourceUrl = 'https://www.sec.gov/Archives/edgar/data/1318605/000162828026064366/exhibit991111111.htm'
  const result = await earningsContext({ official: async (asset, at) => officialEvent(asset, at, {
    status: 'confirmed', date: '2026-10-21', timing: 'after-close', sourceUrl, publishedAt: '2026-10-02T13:04:26Z',
  }) })
  expect(result.health.find(s => s.id === 'tsla-earnings')).toMatchObject({ status: 'ok', provider: 'SEC EDGAR — Tesla official announcement' })
  const snapshot = { ...judgmentSnapshot(), asset: 'TSLA' as const, capturedAt: '2026-10-07T12:00:00Z', context: result.context, sourceHealth: result.health }
  expect(currentOfficialEarnings(snapshot, new Date(snapshot.capturedAt))).toMatchObject({ sourceUrl, date: '2026-10-21' })
})

it('keeps incomplete SEC earnings verification explicit without promoting a generic calendar estimate', async () => {
  const result = await earningsContext({ official: async () => { throw new SecEarningsError('incomplete', true) },
    calendar: { earnings: [{ symbol: 'TSLA', report_date: '2026-10-21' }], meta: { provider: 'fmp', asOf: '2026-10-07T12:00:00Z' } } })
  expect(result.context.nextEarningsAt).toBeNull()
  expect(result.context.earningsEvent).toMatchObject({ status: 'estimated', verification: null })
  expect(result.health.find(s => s.id === 'tsla-earnings')?.detail).toContain('SEC earnings coverage is incomplete')
})
