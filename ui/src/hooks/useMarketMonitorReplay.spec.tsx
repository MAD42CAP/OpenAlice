// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useMarketMonitorReplay } from './useMarketMonitorReplay'
const mocks = vi.hoisted(() => ({ replay: vi.fn() }))
vi.mock('../api', () => ({ api: { marketMonitor: mocks } }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('discards late history responses after switching assets and preserves errors for retry', async () => {
  let finish!: (value: unknown) => void
  mocks.replay.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const hook = renderHook(({ scope }) => useMarketMonitorReplay(scope), { initialProps: { scope: 'BTC' } })
  let pending!: Promise<void>
  act(() => { pending = hook.result.current.select('btc-old') })
  hook.rerender({ scope: 'TSLA' })
  expect(hook.result.current.selected).toBeNull()
  mocks.replay.mockRejectedValueOnce(new Error('archive damaged'))
  await act(async () => { await hook.result.current.select('tsla-old') })
  await act(async () => { finish({ status: 'verified', snapshotId: 'btc-old' }); await pending })
  expect(hook.result.current.result).toBeNull()
  expect(hook.result.current.error).toBe('archive damaged')
  mocks.replay.mockResolvedValueOnce({ status: 'unavailable', snapshotId: 'tsla-old' })
  await act(async () => { await hook.result.current.select('tsla-old') })
  expect(hook.result.current.result?.status).toBe('unavailable')
  expect(hook.result.current.error).toBeNull()
})
