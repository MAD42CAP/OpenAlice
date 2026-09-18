// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MonitorAsset } from '../api/market-monitor'
import type { DashboardWindow, MarketDashboardReport } from '../api/market-dashboard'
import { demoMarketDashboard } from '../demo/fixtures/market-dashboard'
import { useMarketDashboard } from './useMarketDashboard'

const mocks = vi.hoisted(() => ({ report: vi.fn() }))
vi.mock('../api/market-dashboard', () => ({ marketDashboardApi: mocks }))
beforeEach(() => { mocks.report.mockImplementation(async (asset, days) => demoMarketDashboard(asset, days)) })
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('loads the selected asset/window only while visible and refreshes explicitly', async () => {
  const hook = renderHook(({ visible }) => useMarketDashboard('BTC', 90, visible), { initialProps: { visible: false } })
  expect(mocks.report).not.toHaveBeenCalled()
  hook.rerender({ visible: true })
  expect(hook.result.current.loading).toBe(true)
  await waitFor(() => expect(hook.result.current.report?.asset).toBe('BTC'))
  expect(mocks.report).toHaveBeenCalledWith('BTC', 90, expect.any(AbortSignal))
  act(() => hook.result.current.refresh())
  await waitFor(() => expect(mocks.report).toHaveBeenCalledTimes(2))
})

it('does not present late BTC data under a new MSTR window, and retries errors', async () => {
  let resolveOld!: (report: MarketDashboardReport) => void
  mocks.report.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
  const hook = renderHook(({ asset, days }: { asset: MonitorAsset; days: DashboardWindow }) => useMarketDashboard(asset, days, true), { initialProps: { asset: 'BTC' as MonitorAsset, days: 90 as DashboardWindow } })
  mocks.report.mockRejectedValueOnce(new Error('offline'))
  hook.rerender({ asset: 'MSTR', days: 30 })
  expect(hook.result.current.report).toBeNull()
  await waitFor(() => expect(hook.result.current.failed).toBe(true))
  await act(async () => resolveOld(demoMarketDashboard('BTC')))
  expect(hook.result.current.report).toBeNull()
  expect(hook.result.current.failed).toBe(true)
  act(() => hook.result.current.refresh())
  await waitFor(() => expect(hook.result.current.report?.asset).toBe('MSTR'))
  expect(hook.result.current.report?.windowDays).toBe(30)
  expect(hook.result.current.failed).toBe(false)
})

it('aborts pending requests on hide and refreshes when a new scan revision arrives', async () => {
  const hook = renderHook(({ visible, revision }) => useMarketDashboard('TSLA', 365, visible, revision), { initialProps: { visible: true, revision: 'first' } })
  await waitFor(() => expect(hook.result.current.report).not.toBeNull())
  const firstSignal = mocks.report.mock.calls[0][2] as AbortSignal
  hook.rerender({ visible: false, revision: 'first' })
  expect(firstSignal.aborted).toBe(true)
  hook.rerender({ visible: false, revision: 'second' })
  expect(mocks.report).toHaveBeenCalledTimes(1)
  hook.rerender({ visible: true, revision: 'second' })
  await waitFor(() => expect(mocks.report).toHaveBeenCalledTimes(2))
})
