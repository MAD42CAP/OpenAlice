// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { demoThesisReport } from '../../demo/fixtures/market-thesis'
import { MarketThesisView } from './MarketThesisPanel'
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)
const props = () => ({ asset: 'BTC' as const, report: demoThesisReport('BTC'), loading: false, busy: false, error: null, refresh: vi.fn(), save: vi.fn(async () => false), check: vi.fn(async () => true) })
it('keeps unknown text conditions explicit beside the summary and attributed values', async () => {
  render(<MarketThesisView {...props()} />)
  expect(screen.getByText('Evidence incomplete')).toBeTruthy()
  expect(screen.getByText('1 supporting · 0 invalidation triggers · 1 unknown')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Conditions and evidence' }))
  expect(await screen.findByText(/Manual review required/)).toBeTruthy()
  expect(screen.getByText(/Synthetic demo data/)).toBeTruthy()
  expect(screen.getByText(/does not change trend judgments/)).toBeTruthy()
})
it('retains a failed edit and submits its original expected revision despite refreshed data', async () => {
  const p = props(), view = render(<MarketThesisView {...p} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit thesis' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Investment reasoning' }), { target: { value: 'Edited reasoning' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason for this version' }), { target: { value: 'New evidence' } })
  view.rerender(<MarketThesisView {...p} report={demoThesisReport('BTC', p.report.revision!, p.report)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Save new version' }))
  await waitFor(() => expect(p.save).toHaveBeenCalledWith(1, expect.objectContaining({ thesis: 'Edited reasoning' })))
  expect((screen.getByRole('textbox', { name: 'Investment reasoning' }) as HTMLTextAreaElement).value).toBe('Edited reasoning')
})
it('starts empty and restricts metric choices to the selected asset', () => {
  const p = props(); render(<MarketThesisView {...p} asset="TSLA" report={{ ...p.report, asset: 'TSLA', revision: null, current: null, checks: [], revisions: [] }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Create thesis' }))
  expect((screen.getByRole('textbox', { name: 'Investment reasoning' }) as HTMLTextAreaElement).value).toBe('')
  const choices = within(screen.getByRole('combobox', { name: 'Observation' }))
  expect(choices.queryByText('Deribit 8-hour funding (%)')).toBeNull()
  expect(choices.getByText('Text condition · manual review')).toBeTruthy()
})
it('withholds the current success headline when the backend cannot be read', () => {
  render(<MarketThesisView {...props()} error="thesis-unavailable" />)
  expect(screen.queryByText('Evidence incomplete')).toBeNull()
  expect(screen.getByRole('alert')).toBeTruthy()
})
it('shows the same evidence limits in Chinese', async () => {
  await i18n.changeLanguage('zh')
  render(<MarketThesisView {...props()} />)
  expect(screen.getByText('证据尚不完整')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '查看条件与证据' }))
  expect(await screen.findByText('观察值：— · 需人工核验')).toBeTruthy()
  expect(screen.getByText(/不修改趋势判断或 Jev 预测/)).toBeTruthy()
})
