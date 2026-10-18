// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { demoMarketIntelligence } from '../../demo/fixtures/market-intelligence'
import { demoInvestmentExplanation } from '../../demo/fixtures/investment-explanation'
import { MarketInvestmentIntelligence } from './MarketInvestmentIntelligence'
import { formatMonitorDate } from './market-monitor-format'

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)
const noRun = vi.fn()

it('shows a specific single cause per horizon and preserves original publication text in closed details', () => {
  const report = demoMarketIntelligence('MSTR'), original = report.investment.latest!.summary.text
  render(<MarketInvestmentIntelligence report={report} busy={false} onRun={noRun} />)
  expect(screen.getAllByText('Withhold direction')).toHaveLength(3)
  expect(screen.getAllByText('Main reason: the model itself remains uncertain')).toHaveLength(2)
  expect(screen.getByText('Main reason: relevant inputs were unavailable')).toBeTruthy()
  expect(screen.queryByText(original)).toBeNull()
  expect(screen.getByRole('button', { name: 'Analysis and evidence' }).getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'Analysis and evidence' }))
  expect(screen.getByText('Original published summary')).toBeTruthy()
  expect(screen.getByText(original)).toBeTruthy()
  expect(noRun).not.toHaveBeenCalled()
})

it('keeps a TSLA event reason and a conditional price boundary visible without turning a condition into a forecast', () => {
  const report = demoMarketIntelligence('TSLA'), snapshot = report.investment.latest!, long = snapshot.outlooks[2]!
  long.direction = 'conditional-bearish'; long.confirmation = [{ ...long.conclusion, text: 'Future completed close below 300; this is still conditional.' }]
  long.decisionConditions = { confirmation: { metric: 'daily-close', operator: 'lt', threshold: 300, thresholdEvidenceId: null, description: 'Future close below 300.' }, invalidation: { metric: 'daily-close', operator: 'gt', threshold: 400, thresholdEvidenceId: null, description: 'Future close above 400.' } }
  report.investment.explanation = demoInvestmentExplanation(snapshot)
  render(<MarketInvestmentIntelligence report={report} busy={false} onRun={noRun} />)
  expect(screen.getByText('Main reason: nearby earnings can cause a price gap')).toBeTruthy()
  expect(screen.getByText('Conditionally bearish')).toBeTruthy()
  expect(screen.getByText('Key condition: Future completed close below 300; this is still conditional.')).toBeTruthy()
})

it('does not attach current explanation to a selected historical snapshot', () => {
  const report = demoMarketIntelligence()
  render(<MarketInvestmentIntelligence report={report} busy={false} onRun={noRun} />)
  fireEvent.click(screen.getByRole('button', { name: 'Synthesis history' }))
  fireEvent.click(screen.getByRole('button', { name: formatMonitorDate('2026-10-14T18:05:00Z') }))
  const region = within(screen.getByRole('region', { name: 'AI synthesis' }))
  expect(region.getAllByText('No verified explanation is bound to this analysis.')).toHaveLength(3)
  expect(region.queryByText(/Main reason:/)).toBeNull()
  expect(region.queryByText('演示前次综合观点：中性观察。')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Analysis and evidence' }))
  expect(region.getByText('演示前次综合观点：中性观察。')).toBeTruthy()
})

it('does not call a verified clear direction with no reason an unknown reason', () => {
  const report = demoMarketIntelligence('MSTR'), snapshot = report.investment.latest!
  snapshot.outlooks.forEach(row => { row.direction = 'neutral' })
  report.investment.explanation = demoInvestmentExplanation(snapshot)
  report.investment.explanation.outlooks.forEach(row => { row.primaryReason = null; row.reasons = [] })
  render(<MarketInvestmentIntelligence report={report} busy={false} onRun={noRun} />)
  expect(screen.getAllByText('Neutral')).toHaveLength(3)
  expect(screen.queryByText(/No verified explanation|Main reason:/)).toBeNull()
})

it('does not present retained reasons as current after refresh failure', () => {
  render(<MarketInvestmentIntelligence report={demoMarketIntelligence('MSTR')} readError busy={false} onRun={noRun} />)
  expect(screen.getAllByText('The current reason is unavailable; this saved view is reference only.')).toHaveLength(3)
  expect(screen.queryByText(/Main reason:/)).toBeNull()
})
