// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MonitorAsset } from '../api/market-monitor'
import type { ThesisReport } from '../api/market-thesis-types'
import { demoThesisReport } from '../demo/fixtures/market-thesis'
import { useMarketThesis } from './useMarketThesis'
const mock = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), check: vi.fn() }))
vi.mock('../api/market-thesis', () => ({ marketThesisApi: mock }))
beforeEach(() => { vi.useFakeTimers(); mock.read.mockImplementation(async (asset: MonitorAsset) => demoThesisReport(asset)) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks() })
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
it('isolates assets and discards a delayed response from the prior selection', async () => {
  let finish!: (report: ThesisReport) => void
  mock.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const hook = renderHook(({ asset }: { asset: MonitorAsset }) => useMarketThesis(asset, true, 'one'), { initialProps: { asset: 'BTC' as MonitorAsset } })
  hook.rerender({ asset: 'MSTR' }); await flush()
  expect(hook.result.current.report?.asset).toBe('MSTR')
  await act(async () => { finish(demoThesisReport('BTC')) })
  expect(hook.result.current.report?.asset).toBe('MSTR')
})
it('retains prior data on refresh failure and stops polling hidden views', async () => {
  const hook = renderHook(({ visible }) => useMarketThesis('BTC', visible, 'one'), { initialProps: { visible: true } }); await flush()
  mock.read.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(hook.result.current.error).toBe('thesis-unavailable')
  expect(hook.result.current.report?.asset).toBe('BTC')
  hook.rerender({ visible: false })
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(mock.read).toHaveBeenCalledTimes(2)
})
it('exposes revision conflicts without claiming success or losing the saved basis', async () => {
  const hook = renderHook(() => useMarketThesis('BTC', true, 'one')); await flush()
  mock.save.mockRejectedValue(new Error('thesis-conflict'))
  let success = true
  await act(async () => { success = await hook.result.current.save(1, demoThesisReport('BTC').revision!) })
  expect(success).toBe(false)
  expect(hook.result.current.error).toBe('thesis-conflict')
  expect(hook.result.current.report?.revision?.revision).toBe(1)
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(hook.result.current.error).toBe('thesis-conflict')
})
it('does not expose a write response on another asset, and resumes its reads after completion', async () => {
  let finish!: (report: ThesisReport) => void
  mock.check.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const hook = renderHook(({ asset }: { asset: MonitorAsset }) => useMarketThesis(asset, true, 'one'), { initialProps: { asset: 'BTC' as MonitorAsset } }); await flush()
  let pending!: Promise<boolean>
  act(() => { pending = hook.result.current.check() })
  hook.rerender({ asset: 'TSLA' }); await flush()
  await act(async () => { finish(demoThesisReport('BTC')); await pending })
  await flush()
  expect(hook.result.current.report?.asset).toBe('TSLA')
})
