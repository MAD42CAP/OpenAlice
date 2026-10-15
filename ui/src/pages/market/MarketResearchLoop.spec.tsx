// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { demoResearchLoop } from '../../demo/fixtures/research-loop'
import { MarketResearchLoopView } from './MarketResearchLoop'
const defaults = { report: null, loading: false, error: null, running: false, refresh: vi.fn(), run: vi.fn() }
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('keeps one compact summary with research controls and details closed by default', () => {
  render(<MarketResearchLoopView {...defaults} report={demoResearchLoop()} />)
  expect(screen.getByText('3/3 available')).toBeTruthy()
  expect(screen.getByText('Reviewed in synthesis')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Update research' })).toBeNull()
  expect(screen.queryByText('Auto Prediction')).toBeNull()
  const trigger = screen.getByRole('button', { name: 'Research feedback details' })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(trigger)
  expect(screen.getByText(/Predictive value remains unverified/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Update research' }))
  expect(defaults.run).toHaveBeenCalledOnce()
  expect(screen.getAllByText(/Updated/)).toHaveLength(3)
})

it('requires an exact nonempty context match before claiming synthesis has consumed it', () => {
  const report = demoResearchLoop(); report.synthesis!.contextHash = 'previous-context'
  const view = render(<MarketResearchLoopView {...defaults} report={report} />)
  expect(screen.getByText('Awaiting synthesis update')).toBeTruthy()
  expect(screen.queryByText('Reviewed in synthesis')).toBeNull()
  report.synthesis!.contextHash = report.context.hash; report.context.evidence = []
  view.rerender(<MarketResearchLoopView {...defaults} report={{ ...report }} />)
  expect(screen.getByText('Awaiting synthesis update')).toBeTruthy()
})

it('does not count failed or outdated results and exposes them without performance claims', () => {
  const report = demoResearchLoop('failed'); report.contributors[0]!.state = 'stale'
  render(<MarketResearchLoopView {...defaults} report={report} />)
  expect(screen.getByText('1/3 available')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Research feedback details' }))
  expect(screen.getByText('Auto Prediction · Outdated · excluded')).toBeTruthy()
  expect(screen.getByText('Auto Quant · Failed')).toBeTruthy()
  expect(screen.getByText(/Illustrative research feedback/)).toBeTruthy()
})

it('makes loading, errors, retry and busy states explicit in Chinese', async () => {
  await i18n.changeLanguage('zh-CN')
  const view = render(<MarketResearchLoopView {...defaults} loading />)
  expect(screen.getByText('正在读取研究反馈…')).toBeTruthy()
  view.rerender(<MarketResearchLoopView {...defaults} error="run" />)
  expect(screen.getByRole('alert').textContent).not.toContain('private')
  expect(screen.queryByText('已纳入综合研判')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '查看研究反馈' }))
  fireEvent.click(screen.getByRole('button', { name: '重试读取' }))
  expect(defaults.refresh).toHaveBeenCalledOnce()
  view.rerender(<MarketResearchLoopView {...defaults} running />)
  expect((screen.getByRole('button', { name: '正在更新…' }) as HTMLButtonElement).disabled).toBe(true)
})
