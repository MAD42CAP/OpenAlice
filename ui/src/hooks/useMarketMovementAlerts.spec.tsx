// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMarketMovementAlerts } from './useMarketMovementAlerts'
import { demoMovementReport } from '../demo/fixtures/movement-alerts'
import type { MonitorAsset } from '../api/market-monitor'
import type { MovementReport } from '../api/market-movement-alerts'
const mocks = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn(), cancel: vi.fn() }))
vi.mock('../api/market-movement-alerts', () => ({ marketMovementApi: mocks, movementErrorCodes: ['movement-invalid', 'movement-active-plan', 'movement-price-unavailable', 'movement-state-unavailable', 'movement-not-found'] }))
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); mocks.read.mockImplementation(async asset => demoMovementReport(asset)); mocks.create.mockImplementation(async ({ asset }) => demoMovementReport(asset)); mocks.cancel.mockImplementation(async asset => demoMovementReport(asset)) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.resetAllMocks() })
const flush = async () => { await act(async () => {}) }
it('only reads on entry and visible 30-second polling; it never arms on mount', async () => {
  const hook = renderHook(({ visible }) => useMarketMovementAlerts('BTC', visible, ''), { initialProps: { visible: true } })
  await flush(); expect(mocks.read).toHaveBeenCalledTimes(1); expect(mocks.create).not.toHaveBeenCalled()
  await act(async () => vi.advanceTimersByTimeAsync(30_000)); expect(mocks.read).toHaveBeenCalledTimes(2)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => vi.advanceTimersByTimeAsync(60_000)); expect(mocks.read).toHaveBeenCalledTimes(2)
  hook.rerender({ visible: false }); expect((mocks.read.mock.calls[1][1] as AbortSignal).aborted).toBe(true)
  expect(mocks.cancel).not.toHaveBeenCalled()
})
it('aborts a previous asset read and ignores its late result and error', async () => {
  let resolve!: (report: MovementReport) => void
  mocks.read.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const hook = renderHook(({ asset }: { asset: MonitorAsset }) => useMarketMovementAlerts(asset, true, ''), { initialProps: { asset: 'BTC' as MonitorAsset } })
  const signal = mocks.read.mock.calls[0][1] as AbortSignal
  hook.rerender({ asset: 'MSTR' }); await flush(); expect(signal.aborted).toBe(true)
  await act(async () => resolve(demoMovementReport('BTC')))
  expect(hook.result.current.report?.asset).toBe('MSTR'); expect(hook.result.current.error).toBeNull()
})
it('performs only explicit create and cancel actions for the selected asset', async () => {
  const hook = renderHook(() => useMarketMovementAlerts('TSLA', true, '')); await flush()
  await act(async () => { expect(await hook.result.current.create({ downPercent: 3, expiresInHours: 24 })).toBe(true) })
  expect(mocks.create.mock.calls[0][0]).toEqual({ asset: 'TSLA', downPercent: 3, expiresInHours: 24 })
  await act(async () => { await hook.result.current.cancel('saved-id') })
  expect(mocks.cancel.mock.calls[0].slice(0, 2)).toEqual(['TSLA', 'saved-id'])
})
it('recovers a saved-state read error on a subsequent successful poll', async () => {
  mocks.read.mockResolvedValueOnce({ ...demoMovementReport('BTC'), readError: true })
  const hook = renderHook(() => useMarketMovementAlerts('BTC', true, '')); await flush()
  expect(hook.result.current.error).toBe('movement-state-unavailable')
  await act(async () => vi.advanceTimersByTimeAsync(30_000))
  expect(hook.result.current.error).toBeNull()
})
it('re-reads saved state after an ambiguous POST and clears its warning on explicit refresh', async () => {
  mocks.create.mockRejectedValueOnce(new Error('untrusted provider diagnostic'))
  const hook = renderHook(() => useMarketMovementAlerts('BTC', true, '')); await flush()
  await act(async () => { expect(await hook.result.current.create({ upPercent: 3, expiresInHours: 24 })).toBe(false) })
  expect(mocks.read).toHaveBeenCalledTimes(2); expect(hook.result.current.error).toBe('request')
  act(() => hook.result.current.refresh()); await flush()
  expect(hook.result.current.error).toBeNull(); expect(mocks.create).toHaveBeenCalledTimes(1)
})
it('re-reads the current plan after conflict and isolates a late mutation from a new asset', async () => {
  mocks.create.mockRejectedValueOnce(new Error('movement-active-plan'))
  const hook = renderHook(({ asset }: { asset: MonitorAsset }) => useMarketMovementAlerts(asset, true, ''), { initialProps: { asset: 'BTC' as MonitorAsset } }); await flush()
  await act(async () => { await hook.result.current.create({ upPercent: 3, expiresInHours: 24 }) })
  expect(mocks.read).toHaveBeenCalledTimes(2); expect(hook.result.current.error).toBe('movement-active-plan')
  let finish!: (report: MovementReport) => void
  mocks.create.mockImplementationOnce(() => new Promise(done => { finish = done }))
  let pending!: Promise<boolean>
  act(() => { pending = hook.result.current.create({ upPercent: 4, expiresInHours: 24 }) })
  const signal = mocks.create.mock.calls[1][1] as AbortSignal
  hook.rerender({ asset: 'TSLA' }); await flush(); expect(signal.aborted).toBe(true)
  await act(async () => { finish(demoMovementReport('BTC')); await pending })
  expect(hook.result.current.report?.asset).toBe('TSLA'); expect(hook.result.current.error).toBeNull()
})
