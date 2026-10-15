// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MonitorAsset } from '../api/market-monitor'
import { demoResearchLoop } from '../demo/fixtures/research-loop'
import { useResearchLoop } from './useResearchLoop'
const api = vi.hoisted(() => ({ read: vi.fn(), run: vi.fn() }))
vi.mock('../api/research-loop', () => ({ researchLoopApi: api }))
beforeEach(() => { api.read.mockImplementation(async () => demoResearchLoop()); api.run.mockImplementation(async () => demoResearchLoop()) })
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers() })
const flush = () => act(async () => {})
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

it('reads only visible BTC, never starts research on view, and rejects a late selected-asset result', async () => {
  const late = deferred<ReturnType<typeof demoResearchLoop>>(); api.read.mockReturnValueOnce(late.promise)
  const hook = renderHook(({ asset, visible }) => useResearchLoop(asset, visible, 'revision'), { initialProps: { asset: 'BTC' as MonitorAsset, visible: false } })
  expect(api.read).not.toHaveBeenCalled()
  hook.rerender({ asset: 'BTC', visible: true })
  const signal = api.read.mock.calls[0]![0] as AbortSignal
  hook.rerender({ asset: 'TSLA', visible: true }); await flush()
  expect(signal.aborted).toBe(true)
  await act(async () => late.resolve(demoResearchLoop()))
  expect(hook.result.current.report).toBeNull()
  expect(api.read).toHaveBeenCalledTimes(1)
  expect(api.run).not.toHaveBeenCalled()
})

it('polls running research faster, stops on hidden views, and withholds success after read failures', async () => {
  vi.useFakeTimers()
  const report = demoResearchLoop(); report.contributors[0]!.state = 'running'; api.read.mockResolvedValueOnce(report)
  const hook = renderHook(({ visible }) => useResearchLoop('BTC', visible, 'revision'), { initialProps: { visible: true } }); await flush()
  await act(async () => vi.advanceTimersByTimeAsync(5_000))
  expect(api.read).toHaveBeenCalledTimes(2)
  await act(async () => vi.advanceTimersByTimeAsync(5_000))
  expect(api.read).toHaveBeenCalledTimes(2)
  api.read.mockRejectedValueOnce(new Error('private diagnostic'))
  await act(async () => vi.advanceTimersByTimeAsync(25_000))
  expect(hook.result.current.report).toBeNull()
  expect(hook.result.current.error).toBe('read')
  hook.rerender({ visible: false }); await flush()
  await act(async () => vi.advanceTimersByTimeAsync(60_000))
  expect(api.read).toHaveBeenCalledTimes(3)
})

it('runs only on request, prevents duplicates, refreshes status and cancels late updates on selection change', async () => {
  const hook = renderHook(({ asset }) => useResearchLoop(asset, true, 'revision'), { initialProps: { asset: 'BTC' as MonitorAsset } }); await flush()
  const late = deferred<ReturnType<typeof demoResearchLoop>>(); api.run.mockReturnValueOnce(late.promise)
  let request!: Promise<void>
  act(() => { request = hook.result.current.run() })
  act(() => { void hook.result.current.run() })
  expect(api.run).toHaveBeenCalledTimes(1)
  const signal = api.run.mock.calls[0]![0] as AbortSignal
  hook.rerender({ asset: 'MSTR' }); await flush()
  expect(signal.aborted).toBe(true)
  await act(async () => { late.resolve(demoResearchLoop()); await request })
  expect(hook.result.current.report).toBeNull()
  expect(hook.result.current.running).toBe(false)
  hook.rerender({ asset: 'BTC' }); await flush()
  await act(async () => hook.result.current.run())
  expect(api.run).toHaveBeenCalledTimes(2)
  expect(hook.result.current.report?.asset).toBe('BTC')
  expect(api.read).toHaveBeenCalledTimes(3)
})

it('sanitizes update errors and refuses mismatched response protocols', async () => {
  const hook = renderHook(() => useResearchLoop('BTC', true, 'revision')); await flush()
  api.run.mockRejectedValueOnce(new Error('private diagnostic'))
  await act(async () => hook.result.current.run())
  expect(hook.result.current.report).toBeNull()
  expect(hook.result.current.error).toBe('run')
  api.read.mockResolvedValueOnce({ ...demoResearchLoop(), protocol: 'other-version' })
  act(() => hook.result.current.refresh()); await flush()
  expect(hook.result.current.report).toBeNull()
  expect(hook.result.current.error).toBe('read')
})
