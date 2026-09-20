// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTypeSafeReport, useTypeSafeSettings } from './useTypeSafe'
import { demoJevReport } from '../demo/fixtures/typesafe'
import type { MonitorAsset } from '../api/market-monitor'
const mock = vi.hoisted(() => ({ settings: vi.fn(), save: vi.fn(), test: vi.fn(), report: vi.fn(), generate: vi.fn() }))
vi.mock('../api/typesafe', () => ({ typeSafeApi: mock }))
beforeEach(() => { mock.settings.mockResolvedValue({ configured: false, automatic: false, model: 'jev-1.13.0' }); mock.report.mockImplementation(async asset => demoJevReport(asset)); mock.generate.mockResolvedValue({ id: 'test' }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
const flush = async () => { await act(async () => {}) }
it('reads on entry but never generates a paid forecast implicitly', async () => {
  const hook = renderHook(() => useTypeSafeReport('BTC', true, 'snapshot'))
  await flush()
  expect(hook.result.current.report?.asset).toBe('BTC')
  expect(mock.generate).not.toHaveBeenCalled()
  await act(async () => hook.result.current.generate())
  await flush()
  expect(mock.generate).toHaveBeenCalledWith('BTC')
  expect(mock.report).toHaveBeenCalledTimes(2)
})
it('ignores late replies after switching assets and preserves data on read failure', async () => {
  let done!: (value: ReturnType<typeof demoJevReport>) => void
  mock.report.mockImplementationOnce(() => new Promise(resolve => { done = resolve }))
  const hook = renderHook(({ asset }: { asset: MonitorAsset }) => useTypeSafeReport(asset, true, 'snapshot'), { initialProps: { asset: 'BTC' as MonitorAsset } })
  hook.rerender({ asset: 'MSTR' }); await flush()
  await act(async () => done(demoJevReport('BTC')))
  expect(hook.result.current.report?.asset).toBe('MSTR')
  mock.report.mockRejectedValueOnce(new Error('offline'))
  act(() => hook.result.current.refresh()); await flush()
  expect(hook.result.current.report?.asset).toBe('MSTR')
  expect(hook.result.current.error).toBe('load')
})
it('does not fetch a hidden view and reports a model failure without losing the prior record', async () => {
  const hook = renderHook(({ visible }) => useTypeSafeReport('BTC', visible, 'snapshot'), { initialProps: { visible: false } })
  expect(mock.report).not.toHaveBeenCalled()
  hook.rerender({ visible: true }); await flush()
  mock.generate.mockRejectedValueOnce(new Error('Quota unavailable'))
  await act(async () => hook.result.current.generate())
  expect(hook.result.current.error).toBe('Quota unavailable')
  expect(hook.result.current.report?.asset).toBe('BTC')
})
it('saves settings without treating connection status as a prediction', async () => {
  const hook = renderHook(() => useTypeSafeSettings()); await flush()
  mock.save.mockResolvedValue({ configured: true, automatic: false, model: 'jev-1.13.0' })
  await act(async () => { await hook.result.current.save({ apiKey: 'test-only-placeholder' }) })
  expect(hook.result.current.settings?.configured).toBe(true)
  mock.test.mockRejectedValue(new Error('Invalid key'))
  await act(async () => { await hook.result.current.test() })
  expect(hook.result.current.error).toBe('Invalid key')
})
