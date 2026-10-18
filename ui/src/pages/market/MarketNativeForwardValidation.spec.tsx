// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { i18n } from '../../i18n'
import { demoMarketIntelligence } from '../../demo/fixtures/market-intelligence'
import { MarketNativeForwardValidation } from './MarketNativeForwardValidation'

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)
const pending = () => demoMarketIntelligence('TSLA').investment.nativeForward!
function matured() {
  const report = pending(), short = report.current!.summaries[0]!
  Object.assign(short, { pending: 0, uniqueWindows: 4, abstained: 1,
    unconditional: { scored: 2, correct: 1 }, conditionalIntent: { scored: 1, correct: 1 },
    conditions: { defined: 1, confirmationTriggered: 1, invalidationTriggered: 0, bothTriggered: 0 } })
  return report
}

it('shows pending without a zero hit rate and keeps all horizon detail closed', () => {
  render(<MarketNativeForwardValidation asset="TSLA" report={pending()} />)
  expect(screen.getByText(/AI synthesis · independent validation · Waiting/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Review synthesis validation' }).getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByText(/0%|0\/0|Unconditional direction:/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Review synthesis validation' }))
  expect(screen.getByText('Short term · 1 trading sessions')).toBeTruthy()
  expect(screen.getByText(/Neutral and uncertain mean no directional call/)).toBeTruthy()
})

it('separates unconditional accuracy, conditional intent, condition triggers and abstention', () => {
  render(<MarketNativeForwardValidation asset="TSLA" report={matured()} />)
  expect(screen.getByText(/Short term 1\/2 correct · 1 without a direction/)).toBeTruthy()
  expect(screen.queryByText(/Conditional intent: 1\/1/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Review synthesis validation' }))
  expect(screen.getByText('Unconditional direction: 1/2 correct')).toBeTruthy()
  expect(screen.getByText('Conditional intent: 1/1 aligned with the fixed return window')).toBeTruthy()
  expect(screen.getByText(/1 confirmation triggers/)).toBeTruthy()
  expect(screen.getByText(/not a confirmed forecast or a trade hit/)).toBeTruthy()
})

it('does not turn a conditional success or withheld direction into unconditional accuracy', () => {
  const report = matured(), short = report.current!.summaries[0]!
  short.unconditional = { scored: 0, correct: 0 }
  render(<MarketNativeForwardValidation asset="TSLA" report={report} />)
  expect(screen.getByText(/No unconditional calls scored · 1 conditional intents reviewed · 1 without/)).toBeTruthy()
  expect(screen.queryByText(/Short term.*correct|0%|0\/0/)).toBeNull()
})

it('does not borrow an older cohort score when current has no records', () => {
  const report = matured(); report.current = null
  render(<MarketNativeForwardValidation asset="TSLA" report={report} />)
  expect(screen.getByText(/No separately frozen synthesis record yet/)).toBeTruthy()
  expect(screen.queryByText(/1\/2 correct/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Review synthesis validation' }))
  expect(screen.getByText(/Earlier version · separate results/)).toBeTruthy()
})

it('shows archive failures immediately and never labels a failed refresh as current success', () => {
  const report = matured(); report.invalidRecords = 2; report.orphanedRecords = 1
  const view = render(<MarketNativeForwardValidation asset="TSLA" report={report} />)
  expect(screen.getByRole('alert').textContent).toContain('2 invalid and 1 unlinked')
  view.rerender(<MarketNativeForwardValidation asset="TSLA" report={report} error />)
  expect(screen.getByText(/Current validation is unavailable/)).toBeTruthy()
  expect(screen.queryByText(/Short term 1\/2 correct/)).toBeNull()
  report.readError = true
  view.rerender(<MarketNativeForwardValidation asset="TSLA" report={report} />)
  expect(screen.getByText(/Current validation is unavailable/)).toBeTruthy()
})

it('hides another asset immediately and treats a mismatched report as unavailable', () => {
  const view = render(<MarketNativeForwardValidation asset="TSLA" report={matured()} />)
  view.rerender(<MarketNativeForwardValidation asset="MSTR" report={matured()} />)
  expect(screen.getByRole('alert').textContent).toContain('Current validation is unavailable')
  expect(screen.queryByRole('button', { name: 'Review synthesis validation' })).toBeNull()
  expect(screen.queryByText(/1\/2/)).toBeNull()
})

it('marks truncated scoring history as unavailable while row-only truncation preserves valid scores', () => {
  const report = matured(); report.historyTruncated = true; report.current = null; report.cohorts = []
  const view = render(<MarketNativeForwardValidation asset="TSLA" report={report} />)
  expect(screen.getByRole('alert').textContent).toContain('Current validation is unavailable')
  expect(screen.queryByText(/No separately frozen synthesis record|0%|0\/0/)).toBeNull()
  expect(screen.getByRole('button', { name: 'Review synthesis validation' }).getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'Review synthesis validation' }))
  expect(screen.getByText('Only the bounded recent archive is shown.')).toBeTruthy()
  const rowsOnly = matured(); rowsOnly.rowsTruncated = true
  view.rerender(<MarketNativeForwardValidation asset="TSLA" report={rowsOnly} />)
  expect(screen.getByText(/Short term 1\/2 correct/)).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})
