import { describe, expect, it } from 'vitest'
import { retainContext } from './context-cache.js'
import type { SourceHealth } from './types.js'

const source: SourceHealth = { id: 'btc-derivatives', label: 'BTC', provider: 'Deribit', status: 'ok', asOf: '2026-09-17T00:00:00Z', detail: 'loaded' }
describe('last successful context', () => {
  it('bridges a normal 15m15s cadence, survives repeated failures and expires without renewing its time', () => {
    const good = retainContext({ fundingRate: 0.001 }, [source], [], new Date(source.asOf!))
    const failed = { ...source, status: 'unavailable' as const, asOf: null }
    const first = retainContext({}, [failed], good.cache, new Date('2026-09-17T00:15:15Z'))
    expect(first.context.fundingRate).toBe(0.001)
    expect(first.health[0]).toMatchObject({ status: 'unavailable', retained: { asOf: source.asOf, expiresAt: '2026-09-17T00:30:00.000Z', fields: ['fundingRate'] } })
    const second = retainContext({}, [failed], first.cache, new Date('2026-09-17T00:29:00Z'))
    expect(second.health[0]?.retained?.asOf).toBe(source.asOf)
    expect(retainContext({}, [failed], second.cache, new Date('2026-09-17T00:30:01Z')).context).toEqual({})
    expect(retainContext({}, [{ ...failed, provider: 'different' }], good.cache, new Date('2026-09-17T00:20:00Z')).context).toEqual({})
    expect(retainContext({}, [failed], good.cache, new Date('2026-09-16T23:59:00Z')).context).toEqual({})
  })

  it('retains only failed fields while preserving successful empty and current values', () => {
    const good = retainContext({ fundingRate: 0.001, optionOpenInterest: 10 }, [source], [], new Date(source.asOf!))
    const partial = retainContext({ fundingRate: null }, [{ ...source, status: 'degraded', failedFields: ['optionOpenInterest'] }], good.cache, new Date('2026-09-17T00:10:00Z'))
    expect(partial.context).toEqual({ fundingRate: null, optionOpenInterest: 10 })
    const calendar = { ...source, id: 'tsla-calendar-news' }
    const previous = retainContext({ nextEarningsAt: '2026-10-01', recentNews: [{ title: 'old', time: source.asOf!, source: 'fixture' }] }, [calendar], [], new Date(source.asOf!))
    const next = retainContext({ nextEarningsAt: null, recentNews: [] }, [{ ...calendar, status: 'degraded', failedFields: [] }], previous.cache, new Date('2026-09-17T00:10:00Z'))
    expect(next.context).toEqual({ nextEarningsAt: null, recentNews: [] })
    expect(next.health[0]?.retained).toBeUndefined()
  })
})

it('clears successfully empty calendar coverage so a later outage cannot resurrect old events', () => {
  const calendar: SourceHealth = { ...source, id: 'tsla-calendar-news' }
  const prior = retainContext({ nextEarningsAt: '2026-10-01', recentNews: [{ title: 'old headline', time: source.asOf!, source: 'fixture' }] }, [calendar], [], new Date(source.asOf!))
  const empty = retainContext({ nextEarningsAt: null, recentNews: [] }, [{ ...calendar, asOf: '2026-09-17T00:10:00Z', failedFields: [], coverage: { earnings: 'unknown', news: 'empty' } }], prior.cache, new Date('2026-09-17T00:10:00Z'))
  const outage = retainContext({}, [{ ...calendar, status: 'unavailable', asOf: null, failedFields: ['nextEarningsAt', 'recentNews'] }], empty.cache, new Date('2026-09-17T00:20:00Z'))
  expect(outage.context.nextEarningsAt).toBeUndefined()
  expect(outage.context.recentNews).toEqual([])
  expect(JSON.stringify(outage)).not.toContain('old headline')
})

const officialSource: SourceHealth = { id: 'tsla-earnings', label: 'TSLA official earnings', provider: 'Tesla Investor Relations', status: 'ok', asOf: '2026-10-07T12:00:00Z', detail: 'Verified announcement', failedFields: [] }
const calendarNews: SourceHealth = { id: 'tsla-calendar-news', label: 'TSLA calendar and news', provider: 'OpenAlice reference/news', status: 'ok', asOf: officialSource.asOf, detail: 'News loaded', failedFields: [] }
const event = (status: 'confirmed' | 'unavailable' | 'unannounced' | 'conflict' | 'estimated' = 'confirmed'): import('./types.js').MarketEarningsEvent => ({
  asset: 'TSLA', status, date: status === 'confirmed' || status === 'estimated' ? '2026-10-21' : null, timing: 'unknown', webcastAt: null,
  sourceUrl: 'https://ir.tesla.com/', title: 'Official financial results announcement', publishedAt: '2026-10-01T00:00:00Z', retrievedAt: officialSource.asOf!, contentHash: 'a'.repeat(64), verification: status === 'unavailable' || status === 'estimated' ? null : 'live-official', detail: 'Public event fixture',
})

describe('independent earnings cache ownership', () => {
  it('retains failed official events only for display with their original time, independent of successful news', () => {
    const good = retainContext({ nextEarningsAt: '2026-10-21', earningsEvent: event(), recentNews: [] }, [officialSource, calendarNews], [], new Date(officialSource.asOf!))
    const original = JSON.stringify(good.cache)
    const failed = { ...officialSource, status: 'unavailable' as const, asOf: null, failedFields: ['nextEarningsAt', 'earningsEvent'] as const }
    const first = retainContext({ nextEarningsAt: null, earningsEvent: event('unavailable'), recentNews: [] }, [{ ...failed, failedFields: [...failed.failedFields] }, { ...calendarNews, asOf: '2026-10-07T13:00:00Z' }], good.cache, new Date('2026-10-07T13:00:00Z'))
    expect(first.context.earningsEvent).toEqual(event())
    expect(first.context.nextEarningsAt).toBe('2026-10-21')
    expect(first.health[0]).toMatchObject({ status: 'unavailable', asOf: officialSource.asOf, retained: { asOf: officialSource.asOf, expiresAt: '2026-10-08T12:00:00.000Z', fields: ['nextEarningsAt', 'earningsEvent'] } })
    expect(first.context.recentNews).toEqual([])
    expect(JSON.stringify(good.cache)).toBe(original)
    const repeated = retainContext({ nextEarningsAt: null, earningsEvent: event('unavailable') }, [{ ...failed, failedFields: [...failed.failedFields] }], first.cache, new Date('2026-10-08T11:00:00Z'))
    expect(repeated.context.earningsEvent?.retrievedAt).toBe(officialSource.asOf)
    const expired = retainContext({ nextEarningsAt: null, earningsEvent: event('unavailable') }, [{ ...failed, failedFields: [...failed.failedFields] }], repeated.cache, new Date('2026-10-08T12:00:01Z'))
    expect(expired.context.nextEarningsAt).toBeNull()
    expect(expired.context.earningsEvent?.status).toBe('unavailable')
  })

  it.each(['unannounced', 'conflict'] as const)('clears a previously confirmed date after a current official %s observation', status => {
    const good = retainContext({ nextEarningsAt: '2026-10-21', earningsEvent: event() }, [officialSource], [], new Date(officialSource.asOf!))
    const cleared = retainContext({ nextEarningsAt: null, earningsEvent: event(status) }, [{ ...officialSource, status: status === 'conflict' ? 'degraded' : 'ok', asOf: '2026-10-07T13:00:00Z', failedFields: [] }], good.cache, new Date('2026-10-07T13:00:00Z'))
    const failed = retainContext({ nextEarningsAt: null, earningsEvent: event('unavailable') }, [{ ...officialSource, status: 'unavailable', asOf: null, failedFields: ['nextEarningsAt', 'earningsEvent'] }], cleared.cache, new Date('2026-10-07T14:00:00Z'))
    expect(failed.context.nextEarningsAt).toBeNull()
    expect(failed.context.earningsEvent?.status).toBe(status)
    expect(failed.context.earningsEvent?.date).toBeNull()
  })

  it('preserves a new explicit estimate without replacing it with an older confirmed date', () => {
    const good = retainContext({ nextEarningsAt: '2026-10-21', earningsEvent: event() }, [officialSource], [], new Date(officialSource.asOf!))
    const estimate = { ...event('estimated'), date: '2026-10-20', referenceDate: '2026-10-20' }
    const next = retainContext({ nextEarningsAt: null, earningsEvent: estimate }, [{ ...officialSource, status: 'degraded', asOf: null, failedFields: ['nextEarningsAt', 'earningsEvent'] }], good.cache, new Date('2026-10-07T13:00:00Z'))
    expect(next.context).toEqual({ nextEarningsAt: null, earningsEvent: estimate })
    expect(next.health[0]?.retained).toBeUndefined()
  })

  it('does not borrow an old combined-calendar event once the official source owns earnings', () => {
    const old = retainContext({ nextEarningsAt: '2026-10-20', recentNews: [] }, [calendarNews], [], new Date(calendarNews.asOf!))
    const failed = retainContext({ nextEarningsAt: null, earningsEvent: event('unavailable') }, [
      { ...calendarNews, status: 'unavailable', asOf: null },
      { ...officialSource, status: 'unavailable', asOf: null, failedFields: ['nextEarningsAt', 'earningsEvent'] },
    ], old.cache, new Date('2026-10-07T13:00:00Z'))
    expect(failed.context.nextEarningsAt).toBeNull()
    expect(failed.context.earningsEvent?.status).toBe('unavailable')
    expect(failed.health[0]?.retained?.fields ?? []).not.toContain('nextEarningsAt')
  })
})
