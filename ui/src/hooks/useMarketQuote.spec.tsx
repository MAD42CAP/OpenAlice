// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMarketQuote } from './useMarketQuote'
import type { MarketQuote } from '../api/market-quote'
import type { MonitorAsset } from '../api/market-monitor'

const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../api/market-quote', () => ({ marketQuoteApi: mocks }))
const fixture = (asset: MonitorAsset = 'BTC', price = 81234): MarketQuote => ({ asset, price, currency: 'USD', asOf: '2026-09-18T19:00:00Z', fetchedAt: '2026-09-18T19:00:01Z', provider: 'coinbase', feed: 'Coinbase Exchange', status: 'fresh', attempts: [] })
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); mocks.read.mockImplementation(async asset => fixture(asset)) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks() })
const flush = async () => { await act(async () => {}) }

it('updates on entry, explicit refresh and 30-second intervals without a scan', async () => {
  const hook = renderHook(() => useMarketQuote('BTC', true))
  await flush()
  expect(hook.result.current.quote?.price).toBe(81234)
  mocks.read.mockResolvedValueOnce(fixture('BTC', 81235))
  act(() => hook.result.current.refresh()); await flush()
  expect(hook.result.current.quote?.price).toBe(81235)
  await act(async () => vi.advanceTimersByTimeAsync(30_000))
  expect(mocks.read).toHaveBeenCalledTimes(3)
})
it('pauses in hidden tabs and on hidden views, and refreshes on return', async () => {
  const hook = renderHook(({ visible }) => useMarketQuote('BTC', visible), { initialProps: { visible: true } })
  await flush()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => vi.advanceTimersByTimeAsync(60_000))
  expect(mocks.read).toHaveBeenCalledTimes(1)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  act(() => document.dispatchEvent(new Event('visibilitychange'))); await flush()
  expect(mocks.read).toHaveBeenCalledTimes(2)
  const signal = mocks.read.mock.calls[1][1] as AbortSignal
  hook.rerender({ visible: false })
  expect(signal.aborted).toBe(true)
  await act(async () => vi.advanceTimersByTimeAsync(60_000))
  expect(mocks.read).toHaveBeenCalledTimes(2)
})
it('never shows a late BTC reply under MSTR', async () => {
  let resolve!: (quote: MarketQuote) => void
  mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const hook = renderHook(({ asset }: { asset: MonitorAsset }) => useMarketQuote(asset, true), { initialProps: { asset: 'BTC' as MonitorAsset } })
  hook.rerender({ asset: 'MSTR' }); await flush()
  expect(hook.result.current.quote?.asset).toBe('MSTR')
  await act(async () => resolve(fixture('BTC')))
  expect(hook.result.current.quote?.asset).toBe('MSTR')
})
it('retains a previous price with an explicit failure state and recovers automatically', async () => {
  const hook = renderHook(() => useMarketQuote('BTC', true)); await flush()
  mocks.read.mockResolvedValueOnce({ ...fixture(), price: null, status: 'unavailable', attempts: [{ provider: 'coinbase', failure: 'network' }] })
  act(() => hook.result.current.refresh()); await flush()
  expect(hook.result.current.failed).toBe(true)
  expect(hook.result.current.quote?.price).toBe(81234)
  expect(hook.result.current.attempts[0].failure).toBe('network')
  await act(async () => vi.advanceTimersByTimeAsync(30_000))
  expect(hook.result.current.failed).toBe(false)
})
