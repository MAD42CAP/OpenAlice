import { afterEach, expect, it, vi } from 'vitest'
import { contextReadFailure, createContextReader } from './context-read.js'

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

it('retries a transient failure once, with delay, and recovers', async () => {
  vi.useFakeTimers()
  const operation = vi.fn().mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValue('data')
  const result = createContextReader()('fixture', operation)
  await vi.advanceTimersByTimeAsync(249)
  expect(operation).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(await result).toBe('data')
  expect(operation).toHaveBeenCalledTimes(2)
})

it.each(['HTTP 401', 'HTTP 403', 'HTTP 429', 'too_many_requests', 'invalid response'])('does not retry %s', async message => {
  const operation = vi.fn().mockRejectedValue(new Error(message))
  await expect(createContextReader()('fixture', operation)).rejects.toThrow(message)
  expect(operation).toHaveBeenCalledTimes(1)
})

it('bounds waiting and shares a still-pending upstream read across later scans', async () => {
  vi.useFakeTimers()
  let finish!: (value: string) => void
  const operation = vi.fn(() => new Promise<string>(resolve => { finish = resolve }))
  const read = createContextReader()
  const first = expect(read('fixture', operation)).rejects.toThrow('12500ms')
  await vi.advanceTimersByTimeAsync(12_500)
  await first
  await expect(read('fixture', operation)).rejects.toThrow('still pending')
  expect(operation).toHaveBeenCalledTimes(1)
  finish('late result')
  await vi.advanceTimersByTimeAsync(0)
  expect(await read('fixture', async () => 'fresh result')).toBe('fresh result')
})

it('never returns raw request secrets from diagnostics', () => {
  expect(contextReadFailure(new Error('HTTP 403 api_key=fixture-secret'))).toBe('HTTP 403')
  expect(contextReadFailure(new Error('url with private configuration'))).toBe('provider request failed (unclassified)')
})
