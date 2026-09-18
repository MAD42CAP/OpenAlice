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
