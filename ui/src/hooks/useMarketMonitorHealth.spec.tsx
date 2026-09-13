// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MonitorAsset, MonitorHealthReport } from '../api/market-monitor'
import { demoMonitorHealth } from '../demo/fixtures/market-monitor'
import { useMarketMonitorHealth } from './useMarketMonitorHealth'

const mocks = vi.hoisted(() => ({ health: vi.fn(), scan: vi.fn() }))
vi.mock('../api', () => ({ api: { marketMonitor: mocks } }))
beforeEach(() => { vi.useFakeTimers(); mocks.health.mockImplementation(async (asset, hours) => demoMonitorHealth(asset, hours)) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks() })

it('polls read-only reports and stops when the page is hidden', async () => {
  const hook = renderHook(({ visible }) => useMarketMonitorHealth('BTC', 24, visible), { initialProps: { visible: true } })
  expect(hook.result.current.loading).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(hook.result.current.report?.asset).toBe('BTC')
  expect(mocks.health).toHaveBeenCalledTimes(3)
  expect(mocks.scan).not.toHaveBeenCalled()
  hook.rerender({ visible: false })
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(mocks.health).toHaveBeenCalledTimes(3)
})

it('keeps prior facts with a refresh error and clears the error on recovery', async () => {
  const hook = renderHook(() => useMarketMonitorHealth('BTC', 24, true))
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  mocks.health.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await hook.result.current.refresh() })
  expect(hook.result.current.report?.asset).toBe('BTC')
  expect(hook.result.current.error).toBe('offline')
  await act(async () => { await hook.result.current.refresh() })
  expect(hook.result.current.error).toBeNull()
})

it('clears a previous selection and ignores late responses for another asset or window', async () => {
  let resolveOld!: (report: MonitorHealthReport) => void
  const hook = renderHook(({ asset, hours }: { asset: MonitorAsset; hours: 24 | 72 }) => useMarketMonitorHealth(asset, hours, true), { initialProps: { asset: 'BTC' as MonitorAsset, hours: 24 as 24 | 72 } })
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  mocks.health.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
  let old!: Promise<void>
  act(() => { old = hook.result.current.refresh() })
  mocks.health.mockRejectedValueOnce(new Error('TSLA unavailable'))
  hook.rerender({ asset: 'TSLA', hours: 72 })
  expect(hook.result.current.report).toBeNull()
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  await act(async () => { resolveOld(demoMonitorHealth('BTC')); await old })
  expect(hook.result.current.report).toBeNull()
  expect(hook.result.current.loading).toBe(false)
  expect(hook.result.current.error).toBe('TSLA unavailable')
  expect(mocks.health).toHaveBeenLastCalledWith('TSLA', 72)
})

it('does not replace a slow report with repeated polling requests', async () => {
  let resolve!: (report: MonitorHealthReport) => void
  mocks.health.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  const hook = renderHook(() => useMarketMonitorHealth('BTC', 24, true))
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })
  expect(mocks.health).toHaveBeenCalledTimes(1)
  await act(async () => { resolve(demoMonitorHealth('BTC')) })
  expect(hook.result.current.loading).toBe(false)
  expect(hook.result.current.report?.summary.attempts).toBe(3)
})
