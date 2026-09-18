import { describe, expect, it, vi } from 'vitest'
import type { BarService, BarsResult, OhlcvBar } from '../market-data/bars/types.js'
import { createBtcDashboard } from './btc-dashboard.js'

const DAY = 86_400_000
const AT = new Date('2026-09-18T12:00:00Z')
function date(time: number) { return new Date(time).toISOString().slice(0, 10) }
function history(count = 1807): OhlcvBar[] {
  const end = Date.parse('2026-09-18T00:00:00Z')
  return Array.from({ length: count }, (_, index) => ({ date: date(end - (count - index) * DAY), open: 100, high: 110, low: 90, close: 100, volume: 10 }))
}
function result(bars: OhlcvBar[], provider = 'coinbase'): BarsResult {
  return { bars, meta: { symbol: 'BTC-USD', from: bars[0]?.date ?? '', to: bars.at(-1)?.date ?? '', bars: bars.length, sourceId: provider } }
}
function fng(overrides: Record<string, unknown> = {}) {
  return { data: [{ value: '56', timestamp: String(Date.parse('2026-09-18T00:00:00Z') / 1000), ...overrides }], metadata: { error: null } }
}
function mvrv(overrides: Record<string, unknown> = {}) {
  return { data: [{ asset: 'btc', time: '2026-09-17T00:00:00.000000000Z', CapMVRVCur: '1.435849433216295172', ...overrides }] }
}
function setup(bars = history(), body: unknown = fng(), chainBody: unknown = mvrv()) {
  const getBars = vi.fn<BarService['getBars']>().mockResolvedValue(result(bars))
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => new Response(JSON.stringify(String(input).includes('coinmetrics.io') ? chainBody : body)))
  const service = createBtcDashboard({ barService: { getBars, searchBarSources: vi.fn() }, fetcher, now: () => AT })
  return { service, getBars, fetcher }
}

describe('BTC research dashboard', () => {
  it('uses 200 completed weekly closes, excludes the current week, and computes source-volume daily VWAP', async () => {
    const bars = history().map(bar => bar.date >= '2026-09-14' ? { ...bar, open: 200, high: 210, low: 190, close: 200 } : bar)
    bars.push({ date: '2026-09-18', open: 999, high: 1000, low: 998, close: 999, volume: 1000 })
    const { service, getBars } = setup(bars)
    const report = await service.read(30)
    expect(getBars).toHaveBeenCalledTimes(1)
    expect(getBars).toHaveBeenCalledWith({ barId: 'coinbase|BTC-USD', assetClass: 'crypto' }, expect.objectContaining({ interval: '1d', end: '2026-09-17', count: 5000 }))
    expect(report.metrics.find(metric => metric.id === 'btc-200w-ma')).toMatchObject({ value: 100, source: { status: 'ok', dataAt: '2026-09-14T00:00:00.000Z', formulaVersion: 'btc-200w-close-v1' } })
    expect(report.metrics.find(metric => metric.id === 'btc-200w-ratio')?.value).toBe(2)
    expect(report.metrics.find(metric => metric.id === 'btc-closed-price')?.value).toBe(200)
    const anchored = bars.filter(bar => bar.date >= '2024-04-20' && bar.date < '2026-09-18')
    expect(report.metrics.find(metric => metric.id === 'btc-anchored-vwap')?.value).toBeCloseTo(100 + 400 / anchored.length)
    expect(report.series.find(series => series.id === 'btc-cycle-close')?.points.every(point => point.at < '2026-09-18')).toBe(true)
    expect(report.series.find(series => series.id === 'btc-200w-ma')?.points.every(point => Date.parse(point.at) <= AT.getTime())).toBe(true)
  })

  it('weights daily typical prices by volume rather than using a simple average', async () => {
    const bars = history()
    bars[bars.length - 1] = { ...bars.at(-1)!, open: 200, high: 300, low: 100, close: 200, volume: 30 }
    const { service } = setup(bars)
    const report = await service.read(90)
    const count = bars.filter(bar => bar.date >= '2024-04-20').length
    expect(report.metrics.find(metric => metric.id === 'btc-anchored-vwap')?.value).toBeCloseTo(((count - 1) * 1000 + 6000) / ((count - 1) * 10 + 30))
  })

  it('keeps insufficient history unavailable instead of relabelling 400 daily bars as 200 weeks', async () => {
    const { service, getBars } = setup(history(400))
    const report = await service.read(365)
    expect(getBars).toHaveBeenCalledTimes(2)
    expect(report.metrics.find(metric => metric.id === 'btc-200w-ma')).toMatchObject({ value: null, source: { status: 'unavailable' } })
    expect(report.metrics.find(metric => metric.id === 'btc-anchored-vwap')).toMatchObject({ value: null, source: { status: 'unavailable' } })
    expect(report.metrics.find(metric => metric.id === 'btc-closed-price')?.value).toBe(100)
    expect(report.notes.join(' ')).toMatch(/coinbase:.*yfinance:/)
  })

  it.each([
    ['missing date', (bars: OhlcvBar[]) => bars.filter(bar => bar.date !== '2026-09-13')],
    ['missing volume', (bars: OhlcvBar[]) => bars.map(bar => bar.date === '2026-09-13' ? { ...bar, volume: null } : bar)],
  ])('refuses partial anchored history with %s and never fills missing records', async (_label, transform) => {
    const { service } = setup(transform(history()))
    const report = await service.read(30)
    expect(report.metrics.find(metric => metric.id === 'btc-anchored-vwap')).toMatchObject({ value: null, source: { status: 'unavailable' } })
    expect(report.series.find(series => series.id === 'btc-anchored-vwap')?.points).toEqual([])
    expect(report.metrics.find(metric => metric.id === 'btc-closed-price')?.value).toBe(100)
    if (_label === 'missing date') {
      expect(report.metrics.find(metric => metric.id === 'btc-200w-ma')?.value).toBeNull()
    } else {
      expect(report.metrics.find(metric => metric.id === 'btc-200w-ma')?.value).toBe(100)
    }
  })

  it('accepts zero daily volume but refuses an all-zero anchor window', async () => {
    const some = setup(history().map(bar => bar.date === '2026-09-13' ? { ...bar, volume: 0 } : bar))
    expect((await some.service.read(30)).metrics.find(metric => metric.id === 'btc-anchored-vwap')?.value).toBe(100)
    const all = setup(history().map(bar => ({ ...bar, volume: 0 })))
    expect((await all.service.read(30)).metrics.find(metric => metric.id === 'btc-anchored-vwap')?.value).toBeNull()
  })

  it('uses Yahoo when Coinbase lacks complete history and names both providers in fallback details', async () => {
    const { service, getBars } = setup()
    getBars.mockResolvedValueOnce(result(history(400))).mockResolvedValueOnce(result(history(), 'yfinance'))
    const report = await service.read(365)
    expect(getBars.mock.calls[1]?.[0]).toEqual({ barId: 'yfinance|BTC-USD', assetClass: 'crypto' })
    expect(report.metrics.find(metric => metric.id === 'btc-200w-ma')).toMatchObject({ value: 100, source: { provider: 'yfinance', status: 'ok', detail: expect.stringContaining('coinbase:') } })
    expect(report.metrics.find(metric => metric.id === 'btc-anchored-vwap')?.source.detail).toContain('单一来源')
  })

  it('preserves sanitized failures from both price providers without losing successful sentiment', async () => {
    const { service, getBars } = setup()
    getBars.mockRejectedValueOnce(new Error('HTTP 401 token=do-not-display')).mockRejectedValueOnce(new Error('HTTP 429'))
    const report = await service.read(30)
    const price = report.metrics.find(metric => metric.id === 'btc-closed-price')!
    expect(price).toMatchObject({ value: null, source: { status: 'unavailable', detail: expect.stringMatching(/coinbase:.*HTTP 401.*yfinance:.*HTTP 429/) } })
    expect(JSON.stringify(report)).not.toContain('do-not-display')
    expect(report.metrics.find(metric => metric.id === 'btc-fear-greed')?.value).toBe(56)
  })

  it('does not treat stale prices as current simply because the request succeeded', async () => {
    const { service } = setup(history().filter(bar => bar.date <= '2026-09-14'))
    const report = await service.read(30)
    expect(report.metrics.find(metric => metric.id === 'btc-closed-price')).toMatchObject({ value: null, source: { status: 'stale', dataAt: '2026-09-14' } })
    expect(report.series.find(series => series.id === 'btc-cycle-close')!.points.length).toBeGreaterThan(0)
  })

  it.each([
    fng({ value: '' }), fng({ value: '101' }), fng({ value: null }), fng({ value: '12.5' }),
    fng({ timestamp: 'broken' }), fng({ timestamp: '0' }), fng({ timestamp: String(AT.getTime() / 1000 + 1) }),
    { data: [], metadata: { error: null } }, { data: fng().data, metadata: { error: 'upstream error with sensitive body' } },
    { data: [...fng().data, ...fng().data] },
  ])('rejects malformed, duplicate, future, or upstream-error sentiment without fabricating zero: %j', async body => {
    const { service } = setup(history(), body)
    const report = await service.read(30)
    expect(report.metrics.find(metric => metric.id === 'btc-fear-greed')).toMatchObject({ value: null, source: { status: 'unavailable' } })
    expect(report.series.find(series => series.id === 'btc-fear-greed')?.points).toEqual([])
    expect(JSON.stringify(report)).not.toContain('sensitive body')
    expect(report.metrics.find(metric => metric.id === 'btc-closed-price')?.value).toBe(100)
  })

  it('retains valid zero sentiment and attributes every visible metric and series to Alternative.me', async () => {
    const { service, fetcher } = setup(history(), fng({ value: '0' }))
    const report = await service.read(30)
    expect(fetcher).toHaveBeenCalledWith('https://api.alternative.me/fng/?limit=366&format=json', expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }))
    expect(report.metrics.find(metric => metric.id === 'btc-fear-greed')).toMatchObject({ value: 0, source: { provider: 'Alternative.me', publishedAt: null, dataAt: '2026-09-18T00:00:00.000Z', status: 'ok', url: 'https://alternative.me/crypto/fear-and-greed-index/' } })
    expect(report.series.find(series => series.id === 'btc-fear-greed')?.source.provider).toBe('Alternative.me')
  })

  it('keeps stale sentiment only in historical series and declares it stale', async () => {
    const { service } = setup(history(), fng({ timestamp: String(Date.parse('2026-09-14') / 1000) }))
    const report = await service.read(30)
    expect(report.metrics.find(metric => metric.id === 'btc-fear-greed')).toMatchObject({ value: null, source: { status: 'stale' } })
    expect(report.series.find(series => series.id === 'btc-fear-greed')?.points).toHaveLength(1)
  })

  it('does not echo external error bodies or raw transport messages', async () => {
    const { service, fetcher } = setup()
    fetcher.mockResolvedValueOnce(new Response('confidential response body', { status: 403 }))
    const report = await service.read(30)
    expect(JSON.stringify(report)).not.toContain('confidential')
    expect(report.metrics.find(metric => metric.id === 'btc-fear-greed')?.source.detail).toContain('HTTP 403')
    const second = setup()
    second.fetcher.mockRejectedValueOnce(new Error('raw unsafe message'))
    expect(JSON.stringify(await second.service.read(30))).not.toContain('raw unsafe')
  })

  it('shares in-flight work and a bounded cache across windows while preserving fetched timestamps', async () => {
    const { service, getBars, fetcher } = setup()
    const [short, long] = await Promise.all([service.read(30), service.read(365)])
    await service.read(90)
    expect(getBars).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(short.series[0]!.points).toHaveLength(30)
    expect(long.series[0]!.points).toHaveLength(365)
    expect(short.metrics[0]!.source.fetchedAt).toBe(long.metrics[0]!.source.fetchedAt)
  })

  it('retries failed public context after the failure cooldown and refreshes successful data after expiry', async () => {
    let at = AT
    const getBars = vi.fn<BarService['getBars']>().mockResolvedValue(result(history()))
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockImplementation(async input => new Response(JSON.stringify(String(input).includes('coinmetrics.io') ? mvrv() : fng())))
    const service = createBtcDashboard({ barService: { getBars, searchBarSources: vi.fn() }, fetcher, now: () => at })
    await service.read(30)
    at = new Date(AT.getTime() + 30_000)
    await service.read(30)
    expect(fetcher).toHaveBeenCalledTimes(2)
    at = new Date(AT.getTime() + 60_001)
    expect((await service.read(30)).metrics.find(metric => metric.id === 'btc-fear-greed')?.value).toBe(56)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(getBars).toHaveBeenCalledTimes(1)
    at = new Date(AT.getTime() + 16 * 60_000 + 1)
    await service.read(30)
    expect(fetcher).toHaveBeenCalledTimes(5)
  })

  it('aborts a stalled public request without losing price data', async () => {
    vi.useFakeTimers()
    try {
      const { service, fetcher } = setup()
      fetcher.mockImplementationOnce(async (_input, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))))
      const pending = service.read(30)
      await vi.advanceTimersByTimeAsync(10_001)
      const report = await pending
      expect(report.metrics.find(metric => metric.id === 'btc-fear-greed')?.source.detail).toContain('超时')
      expect(report.metrics.find(metric => metric.id === 'btc-closed-price')?.value).toBe(100)
    } finally { vi.useRealTimers() }
  })

  it('loads directly attributed public MVRV with an explicit bounded interval and metric definition', async () => {
    const { service, fetcher } = setup()
    const report = await service.read(365)
    const metric = report.metrics.find(metric => metric.id === 'btc-mvrv')!
    expect(metric.value).toBeCloseTo(1.435849433216295172)
    expect(metric.source).toMatchObject({ status: 'ok', provider: 'Coin Metrics Community', dataAt: '2026-09-17', publishedAt: null, formulaVersion: 'coinmetrics-CapMVRVCur-1d-v1' })
    const call = fetcher.mock.calls.find(([url]) => String(url).includes('coinmetrics.io'))!
    const url = new URL(String(call[0]))
    expect(url.hostname).toBe('community-api.coinmetrics.io')
    expect(url.searchParams.get('metrics')).toBe('CapMVRVCur')
    expect(url.searchParams.get('start_time')).toBe('2025-09-17')
    expect(url.searchParams.get('end_time')).toBe('2026-09-17')
    expect(url.searchParams.get('page_size')).toBe('400')
    expect(url.searchParams.has('api_key')).toBe(false)
    expect(call[1]?.redirect).toBe('error')
    expect(report.series.find(series => series.id === 'btc-mvrv')).toMatchObject({ referenceValue: 1, maxGapMs: 1.5 * DAY })
  })

  it.each([
    mvrv({ CapMVRVCur: null }), mvrv({ CapMVRVCur: '' }), mvrv({ CapMVRVCur: '-1' }), mvrv({ asset: 'eth' }),
    mvrv({ time: '2026-09-18T00:00:00.000000000Z' }), mvrv({ time: '2025-02-30T00:00:00.000000000Z' }),
    { ...mvrv(), next_page_url: 'https://do-not-follow.example.test' }, { ...mvrv(), next_page_token: 'incomplete' },
    { data: [...mvrv().data, ...mvrv().data] },
  ])('keeps invalid or unfinished MVRV unavailable and never follows response URLs: %j', async body => {
    const { service, fetcher } = setup(history(), fng(), body)
    const report = await service.read(30)
    expect(report.metrics.find(metric => metric.id === 'btc-mvrv')).toMatchObject({ value: null, source: { status: 'unavailable' } })
    expect(report.series.find(series => series.id === 'btc-mvrv')?.points).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(report)).not.toContain('do-not-follow')
    expect(report.metrics.find(metric => metric.id === 'btc-fear-greed')?.value).toBe(56)
  })

  it('retains old MVRV points with stale status and no current scalar after 72 hours', async () => {
    const { service } = setup(history(), fng(), mvrv({ time: '2026-09-14T00:00:00.000000000Z' }))
    const report = await service.read(30)
    expect(report.metrics.find(metric => metric.id === 'btc-mvrv')).toMatchObject({ value: null, source: { status: 'stale' } })
    expect(report.series.find(series => series.id === 'btc-mvrv')?.points).toHaveLength(1)
  })
})
