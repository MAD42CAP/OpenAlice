// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useMarketJudgment } from './useMarketJudgment'
import { demoMarketJudgment } from '../demo/fixtures/market-judgment'
import type { MonitorAsset } from '../api/market-monitor'
import type { MarketJudgmentReport } from '../api/market-judgment'
const mock = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../api/market-judgment', () => ({ marketJudgmentApi: mock }))
beforeEach(() => { vi.useFakeTimers(); mock.read.mockImplementation(async asset => demoMarketJudgment(asset)) })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks() })
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

it('polls public summaries, pauses hidden views, and exposes refresh failure without losing prior evidence', async () => {
  const hook = renderHook(({ visible }) => useMarketJudgment('BTC', 'evidence-chain-v1', visible, 'first'), { initialProps: { visible: true } })
  await flush()
  expect(hook.result.current.report?.asset).toBe('BTC')
  mock.read.mockRejectedValueOnce(new Error('offline'))
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
  expect(hook.result.current.error).toBe(true)
  expect(hook.result.current.report?.asset).toBe('BTC')
  hook.rerender({ visible: false })
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  expect(mock.read).toHaveBeenCalledTimes(2)
})
it('rejects a wrong strategy and ignores delayed responses after switching assets', async () => {
  let complete!: (report: MarketJudgmentReport) => void
  mock.read.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  const hook = renderHook(({ asset }: { asset: MonitorAsset }) => useMarketJudgment(asset, 'evidence-chain-v1', true, asset), { initialProps: { asset: 'BTC' as MonitorAsset } })
  hook.rerender({ asset: 'TSLA' }); await flush()
  await act(async () => { complete(demoMarketJudgment('BTC')) })
  expect(hook.result.current.report?.asset).toBe('TSLA')
  mock.read.mockResolvedValueOnce({ ...demoMarketJudgment('MSTR'), strategyId: 'other' })
  hook.rerender({ asset: 'MSTR' }); await flush()
  expect(hook.result.current.report).toBeNull()
  expect(hook.result.current.error).toBe(true)
})
