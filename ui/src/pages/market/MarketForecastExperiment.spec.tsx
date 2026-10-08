import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ForecastExperimentView, MarketForecastExperiment } from './MarketForecastExperiment'
import { demoForecastExperiment } from '../../demo/fixtures/forecast-experiment'
import { forecastExperimentApi } from '../../api/forecast-experiment'
import '../../i18n'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('keeps pending results distinct from wins and explains frozen evidence, frequency and checks', () => {
  const collect = vi.fn(), report = demoForecastExperiment('BTC')
  render(<ForecastExperimentView asset="BTC" report={report} error={false} busy={false} collect={collect} refresh={vi.fn()} />)
  expect(screen.getByText('1 archived comparison groups')).toBeTruthy()
  expect(screen.getAllByText(/Matched Jev sample: 0/)).toHaveLength(3)
  expect(screen.getAllByText(/Frozen combined judgment · Bullish bias/).length).toBeGreaterThan(0)
  expect(screen.queryByText(/judgment\./)).toBeNull()
  expect(screen.getByText(/Frequencies are historical observations/)).toBeTruthy()
  expect(screen.getByText(/not prove an intraday retest/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Record today’s comparison' })); expect(collect).toHaveBeenCalledOnce()
})
it('preserves partial publications visibly when the challenger is unavailable', () => {
  const report = demoForecastExperiment('MSTR'); report.latest!.candidate = null; report.rows[0]!.candidateAvailable = false
  render(<ForecastExperimentView asset="MSTR" report={report} error={false} busy={false} collect={vi.fn()} refresh={vi.fn()} />)
  expect(screen.getByText(/original and combined judgment are saved/)).toBeTruthy()
  expect(screen.queryByText('Jev evidence checks')).toBeNull()
})
it('does not show an earlier selected asset after its delayed request resolves', async () => {
  let resolve!: (value: ReturnType<typeof demoForecastExperiment>) => void
  vi.spyOn(forecastExperimentApi, 'read').mockImplementationOnce(() => new Promise(r => { resolve = r })).mockResolvedValueOnce(demoForecastExperiment('MSTR'))
  const rendered = render(<MarketForecastExperiment asset="BTC" visible revisionKey="1" />)
  rendered.rerender(<MarketForecastExperiment asset="MSTR" visible revisionKey="1" />)
  await waitFor(() => expect(screen.getByText('1 archived comparison groups')).toBeTruthy())
  resolve(demoForecastExperiment('BTC'))
  await waitFor(() => expect(screen.getByRole('region', { name: 'MSTR · Forward comparison' })).toBeTruthy())
  expect(screen.queryByRole('region', { name: 'BTC · Forward comparison' })).toBeNull()
})

it('does not claim improvement when the challenger has the same hits but worse probability error than frequency', () => {
  const report = demoForecastExperiment('MSTR')
  Object.assign(report.summaries[0]!.paired, { count: 11, originalCorrect: 0, challengerCorrect: 8, frequencyCorrect: 8, originalBrier: 1.124, challengerBrier: 0.511, frequencyBrier: 0.472 })
  render(<ForecastExperimentView asset="MSTR" report={report} error={false} busy={false} collect={vi.fn()} refresh={vi.fn()} />)
  expect(screen.getByText('Short term · Probability error has not beaten the baseline')).toBeTruthy()
  expect(screen.getByText('11 identical paired windows · hits: original 0, challenger 8, historical frequency 8.')).toBeTruthy()
  expect(screen.queryAllByText(/Lower error so far/)).toHaveLength(0)
})
