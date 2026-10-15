// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MonitorAsset } from '../api/market-monitor'
import { demoJevReport } from '../demo/fixtures/typesafe'
import { demoForecastExperiment } from '../demo/fixtures/forecast-experiment'
import { useMarketAccuracySummary } from './useMarketAccuracySummary'

const api = vi.hoisted(() => ({ report: vi.fn(), read: vi.fn(), generate: vi.fn(), collect: vi.fn() }))
vi.mock('../api/typesafe', () => ({ typeSafeApi: { report: api.report, generate: api.generate } }))
vi.mock('../api/forecast-experiment', () => ({ forecastExperimentApi: { read: api.read, collect: api.collect } }))
beforeEach(() => {
  api.report.mockImplementation(async asset => demoJevReport(asset))
  api.read.mockImplementation(async asset => demoForecastExperiment(asset))
})
afterEach(() => { cleanup(); vi.resetAllMocks() })
const flush = () => act(async () => {})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

it('reads both archives without generating forecasts and pauses an invisible view', async () => {
  const hook = renderHook(({ visible }) => useMarketAccuracySummary('BTC', visible, 'first'), { initialProps: { visible: false } })
  expect(api.report).not.toHaveBeenCalled()
  expect(api.read).not.toHaveBeenCalled()
  expect(hook.result.current.loading).toBe(false)
  hook.rerender({ visible: true }); await flush()
  expect(hook.result.current.jevReport?.asset).toBe('BTC')
  expect(hook.result.current.experimentReport?.asset).toBe('BTC')
  expect(api.generate).not.toHaveBeenCalled()
  expect(api.collect).not.toHaveBeenCalled()
  hook.rerender({ visible: false })
  expect(hook.result.current.jevReport).toBeNull()
  expect((api.report.mock.calls[0]![1] as AbortSignal).aborted).toBe(true)
  const resumed = deferred<ReturnType<typeof demoJevReport>>()
  api.report.mockReturnValueOnce(resumed.promise)
  hook.rerender({ visible: true })
  expect(hook.result.current.jevReport).toBeNull()
  expect(hook.result.current.loading).toBe(true)
  await act(async () => resumed.resolve(demoJevReport('BTC')))
})

it('clears prior asset immediately and ignores late results even when the request ignores abort', async () => {
  const oldJev = deferred<ReturnType<typeof demoJevReport>>()
  const oldExperiment = deferred<ReturnType<typeof demoForecastExperiment>>()
  api.report.mockReturnValueOnce(oldJev.promise)
  api.read.mockReturnValueOnce(oldExperiment.promise)
  const hook = renderHook(({ asset }: { asset: MonitorAsset }) => useMarketAccuracySummary(asset, true, 'first'), { initialProps: { asset: 'BTC' as MonitorAsset } })
  hook.rerender({ asset: 'MSTR' }); await flush()
  expect((api.report.mock.calls[0]![1] as AbortSignal).aborted).toBe(true)
  expect(hook.result.current.jevReport?.asset).toBe('MSTR')
  await act(async () => { oldJev.resolve(demoJevReport('BTC')); oldExperiment.resolve(demoForecastExperiment('BTC')) })
  expect(hook.result.current.jevReport?.asset).toBe('MSTR')
  expect(hook.result.current.experimentReport?.asset).toBe('MSTR')
})

it('does not present old successful reports as current after a refresh fails, and can retry', async () => {
  const hook = renderHook(() => useMarketAccuracySummary('BTC', true, 'first')); await flush()
  const failure = deferred<ReturnType<typeof demoJevReport>>()
  api.report.mockReturnValueOnce(failure.promise)
  api.read.mockRejectedValueOnce(new Error('private diagnostic must not be shown'))
  act(() => hook.result.current.refresh())
  expect(hook.result.current.loading).toBe(true)
  expect(hook.result.current.jevReport).toBeNull()
  expect(hook.result.current.experimentReport).toBeNull()
  await act(async () => failure.reject(new Error('offline')))
  expect(hook.result.current.error).toBe(true)
  expect(hook.result.current.loading).toBe(false)
  expect(hook.result.current.jevReport).toBeNull()
  act(() => hook.result.current.refresh()); await flush()
  expect(hook.result.current.error).toBe(false)
  expect(hook.result.current.experimentReport?.asset).toBe('BTC')
})

it('rejects mismatched asset reports while keeping only the successful report from this read', async () => {
  api.report.mockResolvedValueOnce(demoJevReport('TSLA'))
  const hook = renderHook(() => useMarketAccuracySummary('BTC', true, 'first')); await flush()
  expect(hook.result.current.jevReport).toBeNull()
  expect(hook.result.current.experimentReport?.asset).toBe('BTC')
  expect(hook.result.current.error).toBe(true)
  api.read.mockResolvedValueOnce(demoForecastExperiment('TSLA'))
  act(() => hook.result.current.refresh()); await flush()
  expect(hook.result.current.experimentReport).toBeNull()
  expect(hook.result.current.jevReport?.asset).toBe('BTC')
  expect(hook.result.current.error).toBe(true)
})

it('ignores stale same-asset replies after the snapshot revision changes', async () => {
  const stale = deferred<ReturnType<typeof demoForecastExperiment>>()
  api.read.mockReturnValueOnce(stale.promise)
  const hook = renderHook(({ revisionKey }) => useMarketAccuracySummary('BTC', true, revisionKey), { initialProps: { revisionKey: 'old' } })
  hook.rerender({ revisionKey: 'new' }); await flush()
  const current = hook.result.current.experimentReport
  await act(async () => {
    const report = demoForecastExperiment('BTC'); report.lastError = 'stale result'
    stale.resolve(report)
  })
  expect(hook.result.current.experimentReport).toBe(current)
  expect(hook.result.current.experimentReport?.lastError).toBeNull()
})

it('aborts both read requests on unmount and never accepts a partial late failure', async () => {
  const late = deferred<ReturnType<typeof demoJevReport>>()
  api.report.mockReturnValueOnce(late.promise)
  const hook = renderHook(() => useMarketAccuracySummary('BTC', true, 'first'))
  hook.unmount()
  expect((api.report.mock.calls[0]![1] as AbortSignal).aborted).toBe(true)
  expect((api.read.mock.calls[0]![1] as AbortSignal).aborted).toBe(true)
  await act(async () => late.reject(new Error('late failure')))
})
