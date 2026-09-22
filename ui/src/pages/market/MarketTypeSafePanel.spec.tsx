// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TypeSafeForecastView } from './MarketTypeSafePanel'
import { demoJevReport } from '../../demo/fixtures/typesafe'
import { i18n } from '../../i18n'
const actions = { refresh: vi.fn(), generate: vi.fn() }
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('labels the experiment, abstention, exact horizons and empty retrospective denominators', () => {
  render(<TypeSafeForecastView asset="BTC" report={demoJevReport('BTC')} loading={false} generating={false} error={null} {...actions} />)
  expect(screen.getByText(/Uncalibrated model probabilities/)).toBeTruthy()
  expect(screen.getByText(/1 session/)).toBeTruthy(); expect(screen.getByText(/7 sessions/)).toBeTruthy(); expect(screen.getByText(/30 sessions/)).toBeTruthy()
  expect(screen.getByText('Assessment: Abstain')).toBeTruthy()
  expect(screen.getAllByText('Not enough resolved data')).toHaveLength(3)
  expect(screen.getByText('Medium term · No scored outcome yet · 1 pending')).toBeTruthy()
  expect(screen.queryByText(/0 \/ 0 correct/)).toBeNull()
  expect(screen.getAllByText(/Matched Jev \/ original rules \(0\)/)).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: 'Generate today’s forecast' }))
  expect(actions.generate).toHaveBeenCalledOnce()
})
it('shows configuration action instead of a working forecast button when no key is saved', () => {
  render(<TypeSafeForecastView asset="MSTR" report={{ ...demoJevReport('MSTR'), configured: false, rows: [] }} loading={false} generating={false} error="load" {...actions} />)
  expect(screen.getByRole('button', { name: 'Configure in AI Provider' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Generate today’s forecast' })).toBeNull()
  expect(screen.getByRole('alert').textContent).toContain('could not be loaded')
})
it('makes small realised counts visible and distinguishes flat-return calls from sideways structures', () => {
  const report = demoJevReport('BTC')
  Object.assign(report.summaries[0], { total: 3, complete: 2, uniqueWindows: 1, duplicateWindows: 1, scored: 1, correct: 0, accuracy: 0, flatCalls: 3, flatOutcomes: 0 })
  render(<TypeSafeForecastView asset="BTC" report={report} loading={false} generating={false} error={null} {...actions} />)
  expect(screen.getByText('Short term · 0 / 1 correct · 1 pending')).toBeTruthy()
  expect(screen.getByText(/1 distinct realised windows · 1 repeated windows/)).toBeTruthy()
  expect(screen.getByText(/3 of 3 saved forecasts explicitly chose flat/)).toBeTruthy()
  expect(screen.getByText(/A sideways structure is not a ±0.25% flat-return forecast/)).toBeTruthy()
})
