// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { demoJevReport } from '../../demo/fixtures/typesafe'
import { demoForecastExperiment } from '../../demo/fixtures/forecast-experiment'
import { i18n } from '../../i18n'
import { accuracyEn, accuracyZh } from '../../i18n/locales/accuracy'
import { MarketAccuracySummaryView } from './MarketAccuracySummary'

const refresh = vi.fn()
beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', { accuracy: accuracyEn }, true, true)
  i18n.addResourceBundle('zh', 'translation', { accuracy: accuracyZh }, true, true)
  await i18n.changeLanguage('en')
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
const renderReports = (experiment = demoForecastExperiment('BTC'), jev = demoJevReport('BTC')) => render(<MarketAccuracySummaryView asset="BTC" jevReport={jev} experimentReport={experiment} loading={false} error={false} refresh={refresh} />)
function resolvedReport() {
  const report = demoForecastExperiment('BTC')
  Object.assign(report.summaries[0]!.paired, { count: 10, originalCorrect: 2, challengerCorrect: 6, frequencyCorrect: null, originalBrier: 1.1, challengerBrier: 0.9, frequencyBrier: 0.6 })
  Object.assign(report.summaries[1]!.paired, { count: 5, originalCorrect: 0, challengerCorrect: 2, frequencyCorrect: 3, originalBrier: 1.2, challengerBrier: 0.8, frequencyBrier: 0.5 })
  return report
}

it('keeps details closed, marks demo data, and never turns pending horizons into zero hit rates', () => {
  renderReports()
  expect(screen.getByText('Illustrative data · not actual forecast performance')).toBeTruthy()
  expect(screen.getByText(/No comparable resolved cohort yet/)).toBeTruthy()
  expect(screen.getByText('Archived Jev: short term awaiting maturity · medium term awaiting maturity · long term awaiting maturity.')).toBeTruthy()
  expect(screen.queryByText(/0\/0/)).toBeNull()
  expect(screen.queryByText(/Brier probability error \(lower is better\)/)).toBeNull()
  expect(screen.getByRole('button', { name: 'Review evidence' }).getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: 'Review evidence' }))
  expect(screen.getByText(/not a trading win rate for the current unified judgment/)).toBeTruthy()
  expect(screen.getByText(/Small, overlapping samples/)).toBeTruthy()
})

it('states archive absence only after successfully reading empty reports', () => {
  const jev = demoJevReport('BTC'), experiment = demoForecastExperiment('BTC')
  jev.rows = []; experiment.rows = []; experiment.latest = null
  for (const summary of jev.summaries) Object.assign(summary, { total: 0, pending: 0 })
  renderReports(experiment, jev)
  expect(screen.getByText('No archived forecast results yet; validation is pending.')).toBeTruthy()
  expect(screen.getByText(/short term awaiting validation · medium term awaiting validation · long term awaiting validation/)).toBeTruthy()
  expect(screen.queryByText(/0%|0\/0/)).toBeNull()
})

it('compares both models on matched probability error despite a missing frequency hit count', () => {
  const jev = demoJevReport('BTC')
  Object.assign(jev.summaries[0]!, { complete: 23, uniqueWindows: 23, scored: 23, correct: 5 })
  Object.assign(jev.summaries[1]!, { complete: 17, uniqueWindows: 17, scored: 17, correct: 0 })
  renderReports(resolvedReport(), jev)
  expect(screen.getByText('In matched, resolved short term / medium term samples, neither model has lower probability error than the historical-frequency baseline so far.')).toBeTruthy()
  expect(screen.getByText(/short term 5\/23 correct · medium term 0\/17 correct · long term awaiting maturity/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Review evidence' }))
  expect(screen.getByText('10 identical resolved windows')).toBeTruthy()
  expect(screen.getByText('Matched hits: original 2 · challenger 6 · historical frequency —')).toBeTruthy()
  expect(screen.getByText('Brier probability error (lower is better): original 1.100 · challenger 0.900 · historical frequency 0.600')).toBeTruthy()
  expect(screen.getByText('No complete matched baseline comparison for this horizon.')).toBeTruthy()
})

it('reports a local reduction as experimental rather than a stable edge, even if only the original is lower', () => {
  const report = resolvedReport()
  report.summaries[0]!.paired.originalBrier = 0.4
  renderReports(report)
  expect(screen.getByText('Some matched short term / medium term samples have lower probability error; a lasting advantage remains unverified.')).toBeTruthy()
  expect(screen.queryByText(/neither model has lower probability error/)).toBeNull()
})

it.each([
  { count: 0, originalBrier: 0.1, challengerBrier: 0.1, frequencyBrier: 1 },
  { count: 1, originalBrier: null, challengerBrier: 0.1, frequencyBrier: 1 },
  { count: 1, originalBrier: 0.1, challengerBrier: 0.1, frequencyBrier: null },
  { count: 1, originalBrier: 0.1, challengerBrier: Number.NaN, frequencyBrier: 1 },
  { count: 1, originalBrier: 0.1, challengerBrier: 0.1, frequencyBrier: Number.POSITIVE_INFINITY },
  { count: 1, originalBrier: 0.1, challengerBrier: 0.1, frequencyBrier: -1 },
  { count: 1, originalBrier: 0.1, challengerBrier: 2.1, frequencyBrier: 1 },
])('withholds advantage conclusions without a complete valid matched cohort: %j', paired => {
  const report = demoForecastExperiment('BTC')
  Object.assign(report.summaries[0]!.paired, paired)
  renderReports(report)
  expect(screen.getByText(/No comparable resolved cohort yet/)).toBeTruthy()
  expect(screen.queryByText(/neither model has lower probability error|Some matched/)).toBeNull()
})

it('does not extrapolate a short-term comparison to unavailable medium or long horizons', () => {
  const report = resolvedReport()
  report.summaries[1]!.paired.originalBrier = null
  renderReports(report)
  expect(screen.getByText('In matched, resolved short term samples, neither model has lower probability error than the historical-frequency baseline so far.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Review evidence' }))
  expect(screen.getAllByText('No complete matched baseline comparison for this horizon.')).toHaveLength(2)
})

it('ignores hit rates when selecting the baseline conclusion and treats a zero Brier as valid', () => {
  const report = resolvedReport()
  Object.assign(report.summaries[0]!.paired, { originalCorrect: 10, challengerCorrect: 10, frequencyCorrect: 0, originalBrier: 0.5, challengerBrier: 0.4, frequencyBrier: 0 })
  renderReports(report)
  expect(screen.getByText(/neither model has lower probability error/)).toBeTruthy()
})

it('shows read failures with retry while refusing another asset’s report', () => {
  render(<MarketAccuracySummaryView asset="BTC" jevReport={demoJevReport('TSLA')} experimentReport={demoForecastExperiment('TSLA')} loading={false} error={true} refresh={refresh} />)
  expect(screen.getByRole('alert').textContent).toContain('Only successfully refreshed results are shown')
  expect(screen.getByText('Archive reports are unavailable; forecast performance cannot be verified right now.')).toBeTruthy()
  expect(screen.queryByText('No archived forecast results yet; validation is pending.')).toBeNull()
  expect(screen.queryByText(/Archived Jev:/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(refresh).toHaveBeenCalledOnce()
})

it('shows only this refresh’s successful matched report when the separate Jev read fails', () => {
  render(<MarketAccuracySummaryView asset="BTC" jevReport={null} experimentReport={resolvedReport()} loading={false} error={true} refresh={refresh} />)
  expect(screen.getByRole('alert')).toBeTruthy()
  expect(screen.getByText(/neither model has lower probability error/)).toBeTruthy()
  expect(screen.queryByText(/Archived Jev:/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Review evidence' }))
  expect(screen.getByText('Jev archive report unavailable.')).toBeTruthy()
})

it('does not imply unresolved scored coverage when matured cases were excluded or abstained', () => {
  const jev = demoJevReport('BTC')
  Object.assign(jev.summaries[0]!, { complete: 3, uniqueWindows: 3, abstained: 3, pending: 1 })
  renderReports(demoForecastExperiment('BTC'), jev)
  expect(screen.getByText(/short term awaiting validation/)).toBeTruthy()
  expect(screen.queryByText(/short term awaiting maturity/)).toBeNull()
})

it('keeps archive-integrity and collection failures visible while hiding provider error text', () => {
  const report = resolvedReport()
  report.invalidRecords = 2; report.historyTruncated = true; report.lastError = 'private provider diagnostic'
  renderReports(report)
  expect(screen.getByRole('alert').textContent).toContain('Forecast collection reported a problem')
  expect(screen.getByText(/2 invalid archive records excluded/)).toBeTruthy()
  expect(screen.queryByText('private provider diagnostic')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Review evidence' }))
  expect(screen.getByText('Only the bounded recent archive was read.')).toBeTruthy()
})

it('uses concise Chinese terminology and explicitly keeps the current unified judgment outside trading accuracy', async () => {
  await i18n.changeLanguage('zh')
  renderReports(resolvedReport())
  expect(screen.getByText('预测实验回看')).toBeTruthy()
  expect(screen.getByText('短期 / 中期的同批已到期样本中，两种模型的概率误差均未低于历史频率基准。')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '查看回看依据' }))
  expect(screen.getByText(/统一判断是对当前证据的条件性解释/)).toBeTruthy()
})
