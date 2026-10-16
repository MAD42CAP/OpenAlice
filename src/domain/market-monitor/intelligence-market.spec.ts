import { describe, expect, it } from 'vitest'
import { buildMarketIntelligence } from './intelligence-market.js'
import { judgmentSnapshot } from './judgment.fixture.js'
import type { MarketMonitorAsset, MarketMonitorSnapshot } from './types.js'

function stock(asset: MarketMonitorAsset = 'TSLA'): MarketMonitorSnapshot {
  const s = judgmentSnapshot()
  s.asset = asset; s.id = `fixture-${asset}`
  s.chart.daily = s.chart.daily.filter(b => ![0, 6].includes(new Date(b.date).getUTCDay()))
  s.chart.intraday = ['15', '16', '17', '18'].flatMap(day => [18, 19].map(h => ({ ...s.chart.daily.at(-1)!, date: `2026-09-${day}T${h}:00:00Z` })))
  s.analysisBasis = { version: 3, closedBarsOnly: true, dailyAt: '2026-09-18', hourlyAt: '2026-09-18T19:00:00Z' }
  s.context = { marketCap: 100_000, trailingPe: 30, nextEarningsAt: '2026-10-20', recentNews: [{ title: 'Public company headline', time: '2026-09-20T11:00:00Z', source: 'Synthetic news' }], recentFilings: [{ form: '8-K', filingDate: '2026-09-17', reportDate: null, description: 'Material event filing', url: 'https://www.sec.gov/Archives/edgar/data/1/fixture.htm' }] }
  s.sourceHealth.push(
    { id: 'fixture-reference', label: 'Reference', provider: 'Synthetic equity reference', status: 'ok', asOf: s.capturedAt, detail: 'Synthetic' },
    { id: 'fixture-calendar-news', label: 'Calendar/news', provider: 'Synthetic calendar', status: 'ok', asOf: s.capturedAt, detail: 'Synthetic', coverage: { earnings: 'available', news: 'matched' } },
    { id: 'fixture-sec-filings', label: 'SEC', provider: 'SEC EDGAR', status: 'ok', asOf: s.capturedAt, detail: 'Synthetic' },
  )
  return s
}

describe('equity market intelligence projection', () => {
  it.each(['TSLA', 'MSTR'] as const)('projects only %s data and keeps weekend closed bars available', asset => {
    const market = buildMarketIntelligence(stock(asset), new Date('2026-09-20T12:05:00Z'))
    expect(market.asset).toBe(asset)
    expect(market.marketDataAsOf).toBe('2026-09-18')
    expect(market.evidence.every(e => e.asset === asset)).toBe(true)
    expect(market.evidence.find(e => e.metric === 'daily-close')).toMatchObject({ value: 101, quality: 'available' })
    expect(market.evidence.find(e => e.metric === 'hourly-close')).toMatchObject({ quality: 'available' })
    expect(market.evidence.some(e => ['funding-8h', 'open-interest', 'put-call-ratio'].includes(e.metric))).toBe(false)
    expect(market.evidence.find(e => e.metric === 'equity.next-earnings')).toMatchObject({ value: '2026-10-20', dataAsOf: '2026-09-20T12:00:00Z', quality: 'available' })
    expect(market.evidence.find(e => e.metric === 'equity.sec-filing.0')).toMatchObject({ sourceName: 'SEC EDGAR', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1/fixture.htm', publishedAt: '2026-09-17', excerpt: expect.stringContaining('尚未解析申报正文') })
    expect(market.evidence.find(e => e.metric === 'equity.news.0')).toMatchObject({ kind: 'interpretation', sourceName: 'Synthetic news', excerpt: expect.stringContaining('未读取') })
  })

  it('does not project sparse after-hours trades into the native hourly evidence', () => {
    const s = stock('MSTR')
    s.chart.intraday.push({ ...s.chart.intraday.at(-1)!, date: '2026-09-18T22:00:00Z', close: 70, low: 69, volume: 1 })
    const market = buildMarketIntelligence(s, new Date('2026-09-20T12:05:00Z'))
    expect(market.hourlyDataAsOf).toBe('2026-09-18T19:00:00Z')
    expect(market.evidence.find(e => e.metric === 'hourly-close')?.value).toBe(101)
    expect(market.hourly.every(bar => !bar.date.includes('T22:'))).toBe(true)
    s.chart.intraday.find(bar => bar.date === '2026-09-18T19:00:00Z')!.volume = 0.1
    const sparse = buildMarketIntelligence(s, new Date('2026-09-20T12:05:00Z'))
    expect(sparse.hourlyDataAsOf).toBeNull()
    expect(sparse.evidence.find(e => e.metric === 'hourly-close')?.quality).toBe('unavailable')
    expect(sparse.hourly).toEqual([])
  })
  it('keeps old stock snapshots readable without certifying their unfiltered hourly basis', () => {
    const s = stock(); s.analysisBasis!.version = 2
    const before = JSON.stringify(s), market = buildMarketIntelligence(s, new Date('2026-09-20T12:05:00Z'))
    expect(market.price).toBe(101)
    expect(market.hourlyDataAsOf).toBeNull()
    expect(market.missingData.join(' ')).toContain('等待新版扫描')
    expect(JSON.stringify(s)).toBe(before)
  })
  it('marks an old frozen hourly basis outdated at the next open while retaining its original timestamp', () => {
    const s = stock(), before = JSON.stringify(s)
    const preopen = buildMarketIntelligence(s, new Date('2026-09-21T12:00:00Z'))
    expect(preopen.evidence.find(e => e.metric === 'hourly-close')?.quality).toBe('available')
    const afterOpen = buildMarketIntelligence(s, new Date('2026-09-21T14:35:00Z'))
    expect(afterOpen.hourlyDataAsOf).toBe('2026-09-18T19:00:00Z')
    expect(afterOpen.evidence.find(e => e.metric === 'hourly-close')).toMatchObject({ dataAsOf: '2026-09-18T19:00:00Z', quality: 'outdated' })
    expect(JSON.stringify(s)).toBe(before)
  })
  it('does not call a forming New York daily bar a completed close', () => {
    const s = stock(); s.capturedAt = '2026-09-21T19:59:00Z'
    s.chart.daily.push({ ...s.chart.daily.at(-1)!, date: '2026-09-21', close: 105 })
    s.analysisBasis!.dailyAt = '2026-09-21'; s.metrics.lastPrice = 105
    const market = buildMarketIntelligence(s, new Date('2026-09-21T20:00:00Z'))
    expect(market.daily.at(-1)!.date).toBe('2026-09-18')
    expect(market.price).toBeNull()
    expect(market.evidence.find(e => e.metric === 'daily-close')?.quality).toBe('unavailable')
    s.capturedAt = '2026-09-21T20:16:00Z'
    expect(buildMarketIntelligence(s, new Date('2026-09-21T20:17:00Z')).price).toBe(105)
  })

  it('marks unknown calendars explicitly and suppresses failed/retained context and unofficial filing links', () => {
    const s = stock('MSTR')
    const calendar = s.sourceHealth.find(row => row.id.endsWith('-calendar-news'))!
    calendar.coverage!.earnings = 'unknown'; calendar.failedFields = ['recentNews']; calendar.retained = { fields: ['nextEarningsAt'], asOf: '2026-09-19', expiresAt: '2026-09-20' }
    s.context.recentFilings![0]!.url = 'https://example.invalid/Archives/filing'
    const market = buildMarketIntelligence(s, new Date('2026-09-20T12:05:00Z'))
    expect(market.evidence.find(e => e.metric === 'equity.next-earnings')?.value).toBeNull()
    expect(market.evidence.some(e => /^equity\.(news|sec-filing)\./.test(e.metric))).toBe(false)
    expect(market.missingData).toContain('财报日历未验证；不得假设未来没有财报事件')
    expect(market.missingData.some(x => x.includes('STRC'))).toBe(true)
  })

  it('does not silently renew context freshness or treat an old equity close as current', () => {
    const s = stock()
    const market = buildMarketIntelligence(s, new Date('2026-09-23T12:05:00Z'))
    expect(market.evidence.find(e => e.metric === 'daily-close')?.quality).toBe('outdated')
    expect(market.evidence.find(e => e.metric === 'equity.market-cap')?.quality).toBe('outdated')
    expect(market.dataQuality).toBe('unavailable')
  })
})
