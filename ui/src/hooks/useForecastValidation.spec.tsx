// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MonitorAsset } from '../api/market-monitor'
import { demoForecastValidation } from '../demo/fixtures/forecast-validation'
import { useForecastValidation } from './useForecastValidation'
const api = vi.hoisted(() => ({ read: vi.fn(), collect: vi.fn() }))
vi.mock('../api/forecast-validation', () => ({ forecastValidationApi: api }))
beforeEach(() => { api.read.mockImplementation(async asset => demoForecastValidation(asset)); api.collect.mockResolvedValue({}) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
const flush = () => act(async () => {})
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

it('does not collect on reads, pauses hidden views and rejects late records for another asset', async () => {
  const hook = renderHook(({ asset, visible }) => useForecastValidation(asset, visible, 'revision'), { initialProps: { asset: 'BTC' as MonitorAsset, visible: false } })
  expect(api.read).not.toHaveBeenCalled()
  const late = deferred<ReturnType<typeof demoForecastValidation>>(); api.read.mockReturnValueOnce(late.promise)
  hook.rerender({ asset: 'BTC', visible: true })
  hook.rerender({ asset: 'TSLA', visible: true }); await flush()
  expect((api.read.mock.calls[0]![1] as AbortSignal).aborted).toBe(true)
  expect(hook.result.current.report?.asset).toBe('TSLA')
  await act(async () => late.resolve(demoForecastValidation('BTC')))
  expect(hook.result.current.report?.asset).toBe('TSLA')
  expect(api.collect).not.toHaveBeenCalled()
})

it('refreshes all visible views of the same asset after an explicit v2 collection', async () => {
  const first = renderHook(() => useForecastValidation('BTC', true, 'revision'))
  const second = renderHook(() => useForecastValidation('BTC', true, 'revision'))
  const other = renderHook(() => useForecastValidation('MSTR', true, 'revision')); await flush()
  expect(api.read).toHaveBeenCalledTimes(3)
  await act(async () => first.result.current.collect())
  expect(api.collect).toHaveBeenCalledExactlyOnceWith('BTC')
  expect(api.read).toHaveBeenCalledTimes(5)
  expect(second.result.current.report?.asset).toBe('BTC')
  expect(other.result.current.report?.asset).toBe('MSTR')
})

it('withholds a prior success when refresh fails and sanitizes collection failures', async () => {
  const hook = renderHook(() => useForecastValidation('BTC', true, 'revision')); await flush()
  api.read.mockRejectedValueOnce(new Error('private diagnostic'))
  act(() => hook.result.current.refresh()); await flush()
  expect(hook.result.current.report).toBeNull()
  expect(hook.result.current.error).toBe('read')
  api.collect.mockRejectedValueOnce(new Error('private diagnostic'))
  await act(async () => hook.result.current.collect())
  expect(hook.result.current.error).toBe('collect')
})

it('reads the prior protocol only when visible and never exposes a legacy collection action', async () => {
  api.read.mockImplementation(async (asset, _signal, protocol) => demoForecastValidation(asset, protocol))
  const hook = renderHook(({ visible }) => useForecastValidation('TSLA', visible, 'history', 'market-forward-v2'), { initialProps: { visible: false } })
  expect(api.read).not.toHaveBeenCalled()
  hook.rerender({ visible: true }); await flush()
  expect(hook.result.current.report?.protocol).toBe('market-forward-v2')
  expect(api.read.mock.calls[0]?.[2]).toBe('market-forward-v2')
  await act(async () => hook.result.current.collect())
  expect(api.collect).not.toHaveBeenCalled()
})
