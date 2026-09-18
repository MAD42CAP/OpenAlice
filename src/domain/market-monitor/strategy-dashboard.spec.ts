import { describe, expect, it, vi } from 'vitest'
import type { BarService } from '../market-data/bars/types.js'
import { createStrategyDashboard, strategyDividends, strategyIssuerModule, strategyNumber } from './strategy-dashboard.js'

const NOW = new Date('2026-09-18T21:00:00Z')
const QUOTE = '2026-09-18T19:00:00'
// Actual issuer response shapes, with synthetic financial values and no auth data.
const bitcoin = () => ({ timestamp: QUOTE, results: { ufPrice: 50_000, btcHoldings: '1,000', satsPerShare: 100_000,
  netSatsPerShare: 75_000, netBtcPerShareUsd: 37.5, mNav: 4, totalAnnualDividends: 100_000, usdMonthsOfDividends: 36,
  totalReserve: 55_000_000, btcNavNumber: 50, usdReserve: 4_000_000, cash: 5_000_000 } })
const mstr = () => [{ company: 'MSTR', timeStampUtc: QUOTE, ufPrice: 150, debt: '6,714', pref: '14,481' }]
const strc = () => [{ company: 'STRC', timeStampUtc: QUOTE, ufPrice: 96, currentDividend: 12, notional: 100_000,
  nextRecordDate: '2026-09-30', nextPayoutDate: '2026-10-15', dividendHistory: [
    { recordDate: '2026-08-31', payDate: '2026-09-15', cashAmount: 0.5, rate: 12 },
    { recordDate: '2026-09-15', payDate: '2026-09-30', cashAmount: 0.5, rate: 12 },
    { recordDate: '2026-09-30', payDate: '2026-10-15', cashAmount: 0.5, rate: 12, isUpcoming: true },
  ] }]
function reads(btc: unknown = bitcoin(), equity: unknown = mstr(), pref: unknown = strc()) {
  return { bitcoin: { value: btc, fetchedAt: NOW.toISOString() }, mstr: { value: equity, fetchedAt: NOW.toISOString() }, strc: { value: pref, fetchedAt: NOW.toISOString() } }
}
function issuer(btc: unknown = bitcoin(), equity: unknown = mstr(), pref: unknown = strc(), at = NOW) {
  return strategyIssuerModule(reads(btc, equity, pref), at, 30)
}
function metric(module: ReturnType<typeof issuer>, id: string) { return module.metrics.find(m => m.id === id)! }
function barService(): BarService {
  return { searchBarSources: vi.fn(), getBars: vi.fn(async (ref) => {
    const symbol = 'barId' in ref ? ref.barId.split('|')[1] : ref.symbol
    const base = symbol === 'BTC-USD' ? 50_000 : symbol === 'STRC' ? 96 : 100
    return { bars: [16, 17, 18].map((day, i) => ({ date: `2026-09-${day}`, open: base, high: base * 2, low: base * 0.5, close: base * (1 + i / 10), volume: 1 })),
      meta: { symbol: symbol!, from: '2026-09-16', to: '2026-09-18', bars: 3, sourceId: 'fixture' } }
  }) }
}
function fetcher() {
  return vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith('bitcoinKpis') ? bitcoin() : String(url).endsWith('mstrKpiData') ? mstr() : strc())))
}

describe('Strategy issuer research dashboard', () => {
  it('parses issuer fields with original units and versions the current mNAV formula', () => {
    const result = issuer()
    expect(metric(result, 'strategy-debt').value).toBe(6_714_000_000)
    expect(metric(result, 'strategy-preferred').value).toBe(14_481_000_000)
    expect(metric(result, 'strategy-btc-holdings').value).toBe(1_000)
    expect(metric(result, 'strategy-assumed-shares-estimate').value).toBe(1_000_000)
    expect(metric(result, 'strategy-mnav')).toMatchObject({ value: 4, source: { dataAt: '2026-09-18T19:00:00.000Z', formulaVersion: 'strategy-net-bps-2026-07-23' } })
    expect(metric(result, 'strc-current-yield').value).toBe(12.5)
    expect(metric(result, 'strc-notional').value).toBe(100_000)
  })

  it('does not invent reporting dates, add overlapping cash, or imply a lifetime runway', () => {
    const result = issuer()
    expect(metric(result, 'strategy-btc-holdings').source).toMatchObject({ dataAt: null, publishedAt: null, status: 'stale' })
    expect(metric(result, 'strategy-usd-reserve')).toMatchObject({ value: null, source: { status: 'unavailable' } })
    expect(metric(result, 'strategy-usd-coverage')).toMatchObject({ value: 36, source: { dataAt: null, status: 'stale' } })
    expect(metric(result, 'strategy-usd-coverage').description).toContain('全部年化债务利息与优先股股息')
    expect(result.series.some(s => s.id === 'strategy-btc-holdings')).toBe(false)
  })

  it('preserves zero but rejects absent, malformed and nonfinite numeric input', () => {
    expect(['', ' ', 'NaN', '1,00', '12%', null, undefined, true, Infinity].map(strategyNumber)).toEqual(Array(9).fill(null))
    expect(['0', 0, '-1.2', '1,234.5'].map(strategyNumber)).toEqual([0, 0, -1.2, 1234.5])
    const b = bitcoin(); b.results.totalAnnualDividends = 0
    const s = strc(); s[0]!.currentDividend = 0
    const result = issuer(b, [{ company: 'MSTR', debt: '0', pref: '' }], s)
    expect(metric(result, 'strategy-annual-obligations').value).toBe(0)
    expect(metric(result, 'strategy-debt').value).toBe(0)
    expect(metric(result, 'strategy-preferred').value).toBeNull()
    expect(metric(result, 'strc-current-yield').value).toBe(0)
  })

  it('refuses old-definition mNAV, unknown timestamps and non-positive Net BPS', () => {
    const old = bitcoin(); old.timestamp = '2026-07-22T19:00:00'
    expect(metric(issuer(old), 'strategy-mnav').value).toBeNull()
    for (const timestamp of ['2026-02-30T12:00:00', '2027-09-18T12:00:00', 'not-a-date', '']) {
      const b = bitcoin(); b.timestamp = timestamp
      expect(metric(issuer(b), 'strategy-mnav').value).toBeNull()
      expect(metric(issuer(b), 'strategy-net-bps').source.dataAt).toBeNull()
    }
    const zero = bitcoin(); zero.results.netBtcPerShareUsd = 0
    expect(metric(issuer(zero), 'strategy-mnav').value).toBeNull()
    expect(metric(issuer(zero), 'strategy-net-bps-usd').value).toBe(0)
    zero.results.netBtcPerShareUsd = -2
    expect(metric(issuer(zero), 'strategy-net-bps-usd').value).toBe(-2)
  })

  it('marks stale market snapshots without replacing their timestamps with request time', () => {
    const b = bitcoin(); b.timestamp = '2026-09-10T19:00:00'
    expect(metric(issuer(b), 'strategy-mnav').source).toMatchObject({ status: 'stale', dataAt: '2026-09-10T19:00:00.000Z', fetchedAt: NOW.toISOString() })
    expect(metric(issuer(bitcoin(), mstr(), [{ company: 'OTHER', ufPrice: 95 }]), 'strc-price').value).toBeNull()
  })

  it('shows future dividend dates as plans and never adds future amounts to historical curves', () => {
    const result = issuer()
    expect(result.events.find(e => e.at === '2026-09-30')).toMatchObject({ label: 'STRC 计划派息 $0.5/股', availableAt: NOW.toISOString() })
    expect(result.series.find(s => s.id === 'strc-dividend-calendar')?.points).toEqual([{ at: '2026-09-15', value: 0.5 }])
    expect(result.series.find(s => s.id === 'strc-dividend-rate-history')?.points).toHaveLength(2)
    expect(result.series.some(s => /total-return/.test(s.id))).toBe(false)
  })

  it('rejects invalid or reversed dates and conflicting duplicate dividends', () => {
    const good = strc()[0]!.dividendHistory[0]!
    expect(strategyDividends([good, good])).toHaveLength(1)
    expect(strategyDividends([good, { ...good, cashAmount: 5 }])).toEqual([])
    expect(strategyDividends([{ ...good, recordDate: '2026-02-30' }, { ...good, payDate: '2026-08-01' }, { ...good, cashAmount: '' }])).toEqual([])
  })

  it('isolates issuer outages from functioning price series and strips raw network errors', async () => {
    const get = vi.fn(async () => { throw new Error('private-provider-message secret=do-not-store') })
    const result = await createStrategyDashboard({ barService: barService(), fetcher: get, now: () => NOW }).read(30)
    expect(metric(result, 'strategy-mnav').source.status).toBe('unavailable')
    expect(result.series.find(s => s.id === 'strc-daily-price')?.points).toHaveLength(3)
    expect(JSON.stringify(result)).not.toMatch(/do-not-store|private-provider-message/)
  })

  it('rejects HTTP 200 wrong identities and preserves independent HTTP errors', async () => {
    const get = vi.fn(async (url: string | URL | Request) => String(url).endsWith('bitcoinKpis')
      ? new Response('private body', { status: 403 }) : new Response(JSON.stringify([{ company: 'WRONG', ufPrice: 999 }])))
    const result = await createStrategyDashboard({ barService: barService(), fetcher: get, now: () => NOW }).read(30)
    expect(metric(result, 'strategy-mnav').source.detail).toContain('HTTP 403')
    expect(metric(result, 'strc-price').source.detail).toContain('证券身份不匹配')
    expect(JSON.stringify(result)).not.toContain('private body')
  })

  it('uses only common closed dates for rebasing and labels asynchronous daily closes', async () => {
    const result = await createStrategyDashboard({ barService: barService(), fetcher: fetcher(), now: () => NOW }).read(30)
    for (const id of ['mstr-normalized', 'btc-normalized']) {
      expect(result.series.find(s => s.id === id)?.points).toEqual([{ at: '2026-09-16', value: 100 }, { at: '2026-09-17', value: 110 }])
      expect(result.series.find(s => s.id === id)?.source.detail).toContain('非同步瞬时收益或相关性')
    }
  })

  it('falls back on bar failure and retains both failures when neither provider works', async () => {
    const bs = barService()
    const original = bs.getBars
    bs.getBars = vi.fn(async (ref, opts) => {
      if ('barId' in ref && (ref.barId.startsWith('alpaca|') || ref.barId.endsWith('|STRC'))) throw new Error('secret=do-not-store')
      return original(ref, opts)
    })
    const result = await createStrategyDashboard({ barService: bs, fetcher: fetcher(), now: () => NOW }).read(30)
    expect(result.series.find(s => s.id === 'mstr-normalized')?.source.detail).toContain('回退原因：alpaca')
    expect(result.series.find(s => s.id === 'strc-daily-price')?.source).toMatchObject({ status: 'unavailable', detail: expect.stringMatching(/alpaca:.*yfinance:/) })
    expect(JSON.stringify(result)).not.toContain('do-not-store')
  })

  it('shares concurrent reads, caches snapshots, and returns isolated copies', async () => {
    const get = fetcher(), bs = barService()
    let at = NOW
    const reader = createStrategyDashboard({ barService: bs, fetcher: get, now: () => at })
    const [a, b] = await Promise.all([reader.read(30), reader.read(30)])
    expect(get).toHaveBeenCalledTimes(3)
    expect(bs.getBars).toHaveBeenCalledTimes(3)
    a.metrics[0]!.value = -999
    expect(b.metrics[0]!.value).toBe(150)
    expect((await reader.read(30)).metrics[0]!.value).toBe(150)
    await reader.read(90)
    expect(get).toHaveBeenCalledTimes(3)
    at = new Date(NOW.getTime() + 301_000)
    await reader.read(30)
    expect(get).toHaveBeenCalledTimes(6)
  })
})
