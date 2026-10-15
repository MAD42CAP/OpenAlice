// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MonitorAsset } from '../api/market-monitor'
import type { MarketIntelligenceReport } from '../api/market-intelligence'
import { demoMarketIntelligence } from '../demo/fixtures/market-intelligence'
import { useMarketIntelligence } from './useMarketIntelligence'
const api = vi.hoisted(() => ({ read: vi.fn(), discover: vi.fn(), importReport: vi.fn(), run: vi.fn() }))
vi.mock('../api/market-intelligence', () => ({ marketIntelligenceApi: api }))
beforeEach(() => { vi.useFakeTimers(); api.read.mockImplementation(async () => demoMarketIntelligence()); api.discover.mockResolvedValue({}); api.importReport.mockResolvedValue({}); api.run.mockResolvedValue({}) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks() })
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

it('only reads BTC and pauses hidden views without exposing another asset’s archives', async () => {
  const hook = renderHook(({ asset, visible }) => useMarketIntelligence(asset, visible, 'first'), { initialProps: { asset: 'TSLA' as MonitorAsset, visible: true } })
  await flush(); expect(api.read).not.toHaveBeenCalled(); expect(hook.result.current.report).toBeNull()
  hook.rerender({ asset: 'BTC', visible: true }); await flush()
  expect(hook.result.current.report?.asset).toBe('BTC')
  hook.rerender({ asset: 'MSTR', visible: true }); await flush()
  expect(hook.result.current.report).toBeNull()
  hook.rerender({ asset: 'BTC', visible: false }); await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(api.read).toHaveBeenCalledOnce()
})
it('retains saved evidence on refresh failure and clears the error after a successful retry', async () => {
  const hook = renderHook(() => useMarketIntelligence('BTC', true, 'first')); await flush()
  api.read.mockRejectedValueOnce(new Error('Offline'))
  act(() => hook.result.current.refresh()); await flush()
  expect(hook.result.current.error).toBe('Offline'); expect(hook.result.current.report?.research.latest).toBeTruthy()
  act(() => hook.result.current.refresh()); await flush()
  expect(hook.result.current.error).toBeNull()
})
it('polls a running native task faster without dispatching new model work', async () => {
  const report = demoMarketIntelligence(); report.job.state = 'running'; api.read.mockResolvedValue(report)
  renderHook(() => useMarketIntelligence('BTC', true, 'first')); await flush()
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
  expect(api.read).toHaveBeenCalledTimes(3); expect(api.run).not.toHaveBeenCalled()
})
it('shows action failure and partial refresh success while retaining the previous report', async () => {
  const hook = renderHook(() => useMarketIntelligence('BTC', true, 'first')); await flush()
  api.importReport.mockRejectedValueOnce(new Error('Public source unavailable'))
  await act(async () => { expect(await hook.result.current.perform('import', { url: 'https://research.glassnode.com/' })).toBe(false) })
  expect(hook.result.current.feedback).toEqual({ action: 'import', state: 'failed', error: 'Public source unavailable' })
  expect(hook.result.current.report?.investment.latest).toBeTruthy()
  api.read.mockRejectedValueOnce(new Error('Refresh failed'))
  await act(async () => { await hook.result.current.perform('discover', undefined, true) })
  expect(api.discover).toHaveBeenCalledWith(true); expect(hook.result.current.feedback?.state).toBe('partial'); expect(hook.result.current.error).toBe('Refresh failed')
})
it('refreshes after accepted imports and synthesis, preserving actual queued job status', async () => {
  const hook = renderHook(() => useMarketIntelligence('BTC', true, 'first')); await flush()
  const queued = demoMarketIntelligence(); queued.job.state = 'queued'; api.read.mockResolvedValue(queued)
  const input = { url: 'https://research.glassnode.com/', title: 'Authorised source', text: 'User provided content' }
  await act(async () => { await hook.result.current.perform('import', input) })
  expect(api.importReport).toHaveBeenCalledWith(input); expect(hook.result.current.report?.job.state).toBe('queued')
  await act(async () => { await hook.result.current.perform('run', undefined, true) })
  expect(api.run).toHaveBeenCalledWith(true); expect(hook.result.current.feedback?.state).toBe('success')
  const calls = api.read.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
  expect(api.read).toHaveBeenCalledTimes(calls + 1)
})
it('ignores delayed reads after switching assets and rejects an unexpected report asset', async () => {
  let resolve!: (report: MarketIntelligenceReport) => void
  api.read.mockImplementationOnce(() => new Promise(value => { resolve = value }))
  const hook = renderHook(({ asset }) => useMarketIntelligence(asset, true, 'first'), { initialProps: { asset: 'BTC' as MonitorAsset } })
  hook.rerender({ asset: 'TSLA' }); await act(async () => { resolve(demoMarketIntelligence()) })
  expect(hook.result.current.report).toBeNull()
  api.read.mockResolvedValueOnce({ ...demoMarketIntelligence(), asset: 'MSTR' })
  hook.rerender({ asset: 'BTC' }); await flush()
  expect(hook.result.current.report).toBeNull(); expect(hook.result.current.error).toBe('Unexpected research asset')
})
