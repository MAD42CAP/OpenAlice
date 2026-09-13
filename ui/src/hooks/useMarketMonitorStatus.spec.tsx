// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMarketMonitorStatus } from './useMarketMonitorStatus'

const mocks = vi.hoisted(() => ({ status: vi.fn(), scan: vi.fn() }))
vi.mock('../api', () => ({ api: { marketMonitor: mocks } }))
const status = { running: true, backgroundEnabled: true, intervalMinutes: 15, checkedAt: null, error: null, assets: [] }
beforeEach(() => { vi.useFakeTimers(); mocks.status.mockResolvedValue(status) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks() })

it('polls status without submitting scans and cleans up when hidden', async () => {
  const hook = renderHook(({ visible }) => useMarketMonitorStatus(visible), { initialProps: { visible: true } })
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(hook.result.current.status).toEqual(status)
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(mocks.status).toHaveBeenCalledTimes(3)
  expect(mocks.scan).not.toHaveBeenCalled()
  hook.rerender({ visible: false })
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(mocks.status).toHaveBeenCalledTimes(3)
})

it('retains prior facts with an explicit error and recovers', async () => {
  const hook = renderHook(() => useMarketMonitorStatus(true))
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  mocks.status.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await hook.result.current.refresh() })
  expect(hook.result.current.status).toEqual(status)
  expect(hook.result.current.error).toBe('offline')
  await act(async () => { await hook.result.current.refresh() })
  expect(hook.result.current.error).toBeNull()
})

it('ignores a late response when a newer status request has completed', async () => {
  let resolveOld!: (value: typeof status) => void
  mocks.status.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
  const hook = renderHook(() => useMarketMonitorStatus(true))
  const paused = { ...status, backgroundEnabled: false }
  mocks.status.mockResolvedValueOnce(paused)
  await act(async () => { await hook.result.current.refresh() })
  await act(async () => { resolveOld(status) })
  expect(hook.result.current.status).toEqual(paused)
})
