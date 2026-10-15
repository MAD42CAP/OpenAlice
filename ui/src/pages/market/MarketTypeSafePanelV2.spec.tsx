// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { demoForecastValidation } from '../../demo/fixtures/forecast-validation'
import { demoForecastExperiment } from '../../demo/fixtures/forecast-experiment'
import { demoJevReport } from '../../demo/fixtures/typesafe'
import { MarketTypeSafePanel } from './MarketTypeSafePanel'
const api = vi.hoisted(() => ({ read: vi.fn(), collect: vi.fn(), legacyRead: vi.fn(), legacyGenerate: vi.fn(), experimentRead: vi.fn(), experimentCollect: vi.fn() }))
vi.mock('../../api/forecast-validation', () => ({ forecastValidationApi: { read: api.read, collect: api.collect } }))
vi.mock('../../api/typesafe', () => ({ typeSafeApi: { report: api.legacyRead, generate: api.legacyGenerate } }))
vi.mock('../../api/forecast-experiment', () => ({ forecastExperimentApi: { read: api.experimentRead, collect: api.experimentCollect } }))
beforeEach(async () => {
  await i18n.changeLanguage('en')
  api.read.mockImplementation(async asset => demoForecastValidation(asset)); api.collect.mockResolvedValue({})
  api.legacyRead.mockImplementation(async asset => demoJevReport(asset)); api.experimentRead.mockImplementation(async asset => demoForecastExperiment(asset))
})
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('uses only v2 for explicit collection and keeps old v1 archives read-only behind disclosure', async () => {
  render(<MarketTypeSafePanel asset="BTC" visible revisionKey="current" />)
  const collect = await screen.findByRole('button', { name: 'Record today’s v2 assessment' })
  await waitFor(() => expect((collect as HTMLButtonElement).disabled).toBe(false))
  expect(api.legacyRead).not.toHaveBeenCalled(); expect(api.experimentRead).not.toHaveBeenCalled()
  fireEvent.click(collect)
  await waitFor(() => expect(api.collect).toHaveBeenCalledExactlyOnceWith('BTC'))
  fireEvent.click(screen.getByRole('button', { name: 'Earlier versions · separate history' }))
  await waitFor(() => { expect(api.legacyRead).toHaveBeenCalledOnce(); expect(api.experimentRead).toHaveBeenCalledOnce() })
  expect(screen.queryByRole('button', { name: 'Generate today’s forecast' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Record today’s comparison' })).toBeNull()
  expect(api.legacyGenerate).not.toHaveBeenCalled(); expect(api.experimentCollect).not.toHaveBeenCalled()
})
