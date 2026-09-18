// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MonitorReview } from './MonitorReview'
import { demoMonitorReview } from '../../demo/fixtures/market-review'
import { i18n } from '../../i18n'

const mocks = vi.hoisted(() => ({ review: vi.fn() }))
vi.mock('../../api', () => ({ api: { marketMonitor: mocks } }))
beforeEach(async () => {
  await i18n.changeLanguage('en')
  mocks.review.mockImplementation(async (asset, days) => demoMonitorReview(asset, days))
})
afterEach(() => { cleanup(); vi.resetAllMocks() })
const show = () => render(<MonitorReview asset="BTC" strategyId="evidence-chain-v1" visible />)

it('compares archived reasoning to a completed window and discloses the observation protocol', async () => {
  show()
  expect(await screen.findByText('What was judged then')).toBeTruthy()
  expect(screen.getByRole('img', { name: /Subsequent opening baseline/ })).toBeTruthy()
  expect(screen.getByText('+3%')).toBeTruthy()
  expect(screen.getByText('-4% / +5%')).toBeTruthy()
  fireEvent.click(screen.getByText('How this review is calculated'))
  expect(screen.getByText(/Absolute moves of at most 0.25%/)).toBeTruthy()
  expect(screen.getByText(/Illustrative demo data/)).toBeTruthy()
  expect(mocks.review).toHaveBeenCalledWith('BTC', 30, expect.any(AbortSignal))
})

it('changes windows without claiming pending observations failed and retains original prose separately', async () => {
  show()
  await screen.findByText('What was judged then')
  fireEvent.change(screen.getByLabelText('Forward window'), { target: { value: 'week' } })
  expect(screen.getByText(/The observation window is still open/)).toBeTruthy()
  expect(screen.queryByText('+3%')).toBeNull()
  fireEvent.change(screen.getByLabelText('Record type'), { target: { value: 'narration' } })
  expect(await screen.findByText('Demo original interpretation')).toBeTruthy()
  expect(screen.getByText(/Free text has no pre-registered/)).toBeTruthy()
  expect(screen.queryByText('Agreement (samples)')).toBeNull()
})

it('keeps absent archives and unavailable data explicit without displaying an inflated rate', async () => {
  const data = demoMonitorReview('BTC')
  data.rows = [data.rows[0]!]
  data.rows[0]!.archiveStatus = 'unavailable'
  data.rows[0]!.outcomes.forEach(o => { o.status = 'unverified'; o.verdict = 'not-scored'; o.changePercent = null })
  data.summaries.forEach(s => { s.agreementPercent = null; s.scored = 0; s.supported = 0; s.excluded = 1 })
  mocks.review.mockResolvedValue(data)
  show()
  expect(await screen.findByText(/Original basis unavailable/)).toBeTruthy()
  expect(screen.getByText(/Today’s data cannot recreate/)).toBeTruthy()
  expect(screen.getByText('— (0)')).toBeTruthy()
})

it('uses a lesson to open its exact source case', async () => {
  show()
  await screen.findByText('What was judged then')
  const lesson = screen.getByText(/daily interpretations retain their original text/)
  fireEvent.click(within(lesson).getByRole('button', { name: 'View case' }))
  expect(await screen.findByText('Demo original interpretation')).toBeTruthy()
  expect((screen.getByLabelText('Original observation') as HTMLSelectElement).value).toBe('demo-review-BTC-1')
})

it('reports load failure and retries without dispatching any market scan', async () => {
  mocks.review.mockRejectedValueOnce(new Error('unavailable'))
  show()
  expect(await screen.findByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh review' }))
  expect(await screen.findByText('What was judged then')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Lookback'), { target: { value: '7' } })
  await waitFor(() => expect(mocks.review).toHaveBeenLastCalledWith('BTC', 7, expect.any(AbortSignal)))
})

it('ignores a stale asset response and aborts on unmount', async () => {
  let resolve!: (value: ReturnType<typeof demoMonitorReview>) => void
  mocks.review.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const view = show()
  const signal = mocks.review.mock.calls[0]![2] as AbortSignal
  view.rerender(<MonitorReview asset="TSLA" strategyId="evidence-chain-v1" visible />)
  await screen.findByText('What was judged then')
  resolve(demoMonitorReview('BTC'))
  await waitFor(() => expect((screen.getByLabelText('Original observation') as HTMLSelectElement).value).toContain('TSLA'))
  expect(signal.aborted).toBe(true)
  const current = mocks.review.mock.calls.at(-1)![2] as AbortSignal
  view.unmount()
  expect(current.aborted).toBe(true)
})

it('explains the score boundary and original conditions in Chinese', async () => {
  await i18n.changeLanguage('zh')
  show()
  expect(await screen.findByText('历史复盘')).toBeTruthy()
  expect(await screen.findByText(/不是未来胜率/)).toBeTruthy()
  expect(screen.getByText(/不代表整个威科夫阶段已获确认/)).toBeTruthy()
  expect(screen.getByText(/下一次每日简报输入交给 Codex/)).toBeTruthy()
})
