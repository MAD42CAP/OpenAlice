// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { demoMonitorHealth, demoMonitorSnapshot } from '../demo/fixtures/market-monitor'
import { i18n } from '../i18n'
import { MarketEvidenceMonitorPage } from './MarketEvidenceMonitorPage'

const mocks = vi.hoisted(() => ({
  health: vi.fn(), status: vi.fn(), narratorStatus: vi.fn(), runNarratorNow: vi.fn(), reconcileNarrator: vi.fn(), settings: vi.fn(), strategies: vi.fn(), snapshots: vi.fn(), alerts: vi.fn(), evaluation: vi.fn(), scan: vi.fn(), saveSettings: vi.fn(),
}))
vi.mock('../api', () => ({ api: { marketMonitor: mocks } }))

beforeEach(async () => {
  await i18n.changeLanguage('en')
  window.localStorage.clear()
  mocks.health.mockImplementation(async (asset: 'BTC' | 'TSLA' | 'MSTR', hours: 24 | 72) => demoMonitorHealth(asset, hours))
  const settings = { backgroundEnabled: false, codexNarrationEnabled: true, enabledAssets: ['BTC', 'TSLA', 'MSTR'], strategyId: 'evidence-chain-v1', intervalMinutes: 15, notifications: false, alertConfidence: 68, abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5 }
  mocks.status.mockResolvedValue({ running: true, backgroundEnabled: false, intervalMinutes: 15, checkedAt: null, error: null, assets: ['BTC', 'TSLA', 'MSTR'].map((asset) => ({ asset, enabled: true, scanning: false, nextScanAt: null, lastReceipt: null })) })
  const narratorBase = { enabled: true, state: 'ready', issueId: 'mad42lab-market-daily-interpretation', schedule: { cron: '30 17 * * *', timezone: 'America/Vancouver', localTime: '17:30' } }
  mocks.narratorStatus.mockImplementation(async () => mocks.runNarratorNow.mock.calls.length
    ? { ...narratorBase, message: 'Run complete.', lastRun: { taskId: 'codex-run-1', status: 'done', startedAt: '2026-09-12T17:30:00Z', finishedAt: '2026-09-12T17:31:00Z' } }
    : { ...narratorBase, message: 'Codex daily narration is enabled.' })
  mocks.runNarratorNow.mockResolvedValue({ ...narratorBase, message: 'Run dispatched.', lastRun: { taskId: 'codex-run-1', status: 'running', startedAt: '2026-09-12T17:30:00Z' } })
  mocks.settings.mockResolvedValue(settings)
  mocks.strategies.mockResolvedValue({ strategies: [{ id: 'evidence-chain-v1', label: 'Evidence chain', version: 1, description: 'fixture', requiredData: ['daily-bars', 'hourly-bars', 'asset-context'] }] })
  mocks.snapshots.mockImplementation(async (asset: 'BTC' | 'TSLA' | 'MSTR') => ({ snapshots: [demoMonitorSnapshot(asset)], count: 1 }))
  mocks.alerts.mockResolvedValue({ alerts: [], count: 0 })
  mocks.evaluation.mockImplementation(async (asset: 'BTC' | 'TSLA' | 'MSTR') => ({ asset, samples: 1, resolved: 0, directionalAccuracy: null, averageForwardChangePercent: null, rows: [] }))
  mocks.scan.mockResolvedValue({ snapshot: demoMonitorSnapshot('BTC'), stored: false, alert: null, receipt: {} })
  mocks.saveSettings.mockImplementation(async (value) => value)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('shows actual fallback attribution, original errors and failed stage in Chinese too', async () => {
  await i18n.changeLanguage('zh-CN')
  const fallback = 'Preferred source coinbase failed; explicit yfinance fallback used (Only 0 usable 1d bars). 400 attributed bars.'
  mocks.snapshots.mockImplementation(async (asset: 'BTC' | 'TSLA' | 'MSTR') => {
    const snapshot = demoMonitorSnapshot(asset)
    snapshot.sourceHealth[0] = { id: 'daily-bars', label: 'Daily OHLCV', provider: 'yfinance', status: 'degraded', asOf: '2026-09-15', detail: fallback }
    return { snapshots: [snapshot], count: 1 }
  })
  mocks.health.mockImplementation(async (asset: 'BTC' | 'TSLA' | 'MSTR', hours: 24 | 72) => {
    const report = demoMonitorHealth(asset, hours)
    report.recent[0] = { ...report.recent[0]!, outcome: 'failed', failureStage: 'daily-bars', error: 'daily-bars: BTC 1d: coinbase failed (HTTP 403); yfinance failed (HTTP 429)', sourceHealth: [{ id: 'daily-bars', label: 'Daily OHLCV', provider: 'coinbase', status: 'unavailable', asOf: null, detail: 'HTTP 403 view denied' }] }
    return report
  })
  render(<MarketEvidenceMonitorPage />)
  expect(await screen.findByText(fallback)).toBeTruthy()
  expect(await screen.findByText(/daily-bars: BTC 1d: coinbase failed.*yfinance failed/)).toBeTruthy()
  expect(screen.getByText(/HTTP 403 view denied/)).toBeTruthy()
})

it('shows attributed BTC evidence and switches to the independent hourly series', async () => {
  render(<MarketEvidenceMonitorPage />)
  expect((await screen.findAllByText('Demand has provisional control')).length).toBeGreaterThan(0)
  expect(screen.getAllByText('demo/coinbase').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: '1H' }))
  expect(screen.getByRole('button', { name: '1H' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('img', { name: /Price path ending/ })).toBeTruthy()
})

it('switches between BTC, TSLA and MSTR without losing independent asset history', async () => {
  render(<MarketEvidenceMonitorPage />)
  await screen.findAllByText('Demand has provisional control')
  fireEvent.click(screen.getByRole('tab', { name: /TSLA/ }))
  expect((await screen.findAllByText('Evidence remains balanced')).length).toBeGreaterThan(0)
  expect(screen.getByText('Trailing P/E')).toBeTruthy()
  expect(screen.getByRole('link', { name: '8-K' }).getAttribute('href')).toContain('sec.gov/Archives/edgar')
  expect(screen.getAllByText('TSLA SEC filings').length).toBeGreaterThan(0)
  expect(mocks.snapshots).toHaveBeenCalledWith('BTC', 120, 'evidence-chain-v1')
  expect(mocks.snapshots).toHaveBeenCalledWith('TSLA', 120, 'evidence-chain-v1')
  expect(mocks.snapshots).toHaveBeenCalledWith('MSTR', 120, 'evidence-chain-v1')
  fireEvent.click(screen.getByRole('tab', { name: /MSTR/ }))
  expect(await screen.findByText('MSTR market state')).toBeTruthy()
})

it('keeps the rendered snapshot when a background refresh fails', async () => {
  render(<MarketEvidenceMonitorPage />)
  await screen.findAllByText('Demand has provisional control')
  mocks.scan.mockRejectedValueOnce(new Error('offline'))
  fireEvent.click(screen.getByRole('button', { name: /Scan now/ }))
  await waitFor(() => expect(screen.getByText('BTC scan failed: offline')).toBeTruthy())
  expect(screen.getAllByText('Demand has provisional control').length).toBeGreaterThan(0)
})

it('shows scan progress immediately and confirms a new result when it finishes', async () => {
  let finishScan!: (value: unknown) => void
  mocks.scan.mockImplementationOnce(() => new Promise((resolve) => { finishScan = resolve }))
  render(<MarketEvidenceMonitorPage />)
  await screen.findAllByText('Demand has provisional control')
  fireEvent.click(screen.getByRole('button', { name: /Scan now/ }))
  expect(screen.getByRole('button', { name: 'Scanning BTC…' }).getAttribute('aria-busy')).toBe('true')
  expect(screen.getByText('Scanning BTC, fetching market data and recalculating evidence…')).toBeTruthy()
  finishScan({ snapshot: demoMonitorSnapshot('BTC'), stored: true, alert: null, receipt: {} })
  expect(await screen.findByText('BTC scan complete. New monitor results are now displayed.')).toBeTruthy()
  expect(screen.getByRole('button', { name: /Scan now/ }).getAttribute('aria-busy')).toBe('false')
})

it('renders the registered strategy in monitor settings', async () => {
  render(<MarketEvidenceMonitorPage />)
  await screen.findAllByText('Demand has provisional control')
  fireEvent.click(screen.getByRole('button', { name: 'Monitor settings' }))
  expect((screen.getByRole('combobox', { name: 'Strategy' }) as HTMLSelectElement).value).toBe('evidence-chain-v1')
  expect(screen.getByRole('option', { name: 'Evidence chain v1' })).toBeTruthy()
})

it('keeps Codex daily interpretation enabled by default and can dispatch it now', async () => {
  render(<MarketEvidenceMonitorPage />)
  await screen.findAllByText('Codex daily interpretation')
  fireEvent.click(screen.getByRole('button', { name: /Run Codex/ }))
  await waitFor(() => expect(mocks.runNarratorNow).toHaveBeenCalledOnce())
  expect(await screen.findByText('Codex interpretation complete. The latest available BTC, TSLA and MSTR results are now displayed.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Monitor settings' }))
  expect((screen.getByRole('checkbox', { name: /Codex daily interpretation/ }) as HTMLInputElement).checked).toBe(true)
})

it('keeps Codex visibly busy until its background task actually finishes', async () => {
  render(<MarketEvidenceMonitorPage />)
  await screen.findAllByText('Codex daily interpretation')
  let finishStatus!: (value: unknown) => void
  mocks.narratorStatus.mockImplementationOnce(() => new Promise((resolve) => { finishStatus = resolve }))
  fireEvent.click(screen.getByRole('button', { name: /Run Codex/ }))
  await waitFor(() => expect(mocks.narratorStatus).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('button', { name: 'Codex analyzing…' }).getAttribute('aria-busy')).toBe('true')
  expect(screen.getByText('Codex is analyzing BTC, TSLA and MSTR. Results will appear automatically when complete.')).toBeTruthy()
  finishStatus({
    enabled: true,
    state: 'ready',
    issueId: 'mad42lab-market-daily-interpretation',
    schedule: { cron: '30 17 * * *', timezone: 'America/Vancouver', localTime: '17:30' },
    message: 'Run complete.',
    lastRun: { taskId: 'codex-run-1', status: 'done', startedAt: '2026-09-12T17:30:00Z', finishedAt: '2026-09-12T17:31:00Z' },
  })
  expect(await screen.findByText('Codex interpretation complete. The latest available BTC, TSLA and MSTR results are now displayed.')).toBeTruthy()
})

it('opens empty history without silently dispatching a scan', async () => {
  mocks.snapshots.mockResolvedValue({ snapshots: [], count: 0 })
  render(<MarketEvidenceMonitorPage />)
  await screen.findByText('No observations yet')
  expect(await screen.findByRole('table', { name: 'Recent scan attempts' })).toBeTruthy()
  expect(mocks.scan).not.toHaveBeenCalled()
})

it('selects a per-asset operational report independently of the evidence history', async () => {
  render(<MarketEvidenceMonitorPage />)
  await screen.findByRole('table', { name: 'Data source reliability' })
  fireEvent.click(screen.getByRole('button', { name: '72 hours' }))
  await waitFor(() => expect(mocks.health).toHaveBeenCalledWith('BTC', 72))
  fireEvent.click(screen.getByRole('tab', { name: /TSLA/ }))
  await waitFor(() => expect(mocks.health).toHaveBeenCalledWith('TSLA', 72))
  expect(await screen.findByRole('region', { name: 'TSLA monitor operations' })).toBeTruthy()
  expect(mocks.scan).not.toHaveBeenCalled()
})

it('saves explicit background consent and a selected asset', async () => {
  render(<MarketEvidenceMonitorPage />)
  await screen.findAllByText('Demand has provisional control')
  fireEvent.click(screen.getByRole('button', { name: 'Monitor settings' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Background monitoring' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'TSLA' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'MSTR' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ backgroundEnabled: true, enabledAssets: ['BTC'] })))
})

it('keeps settings open and reports a failed save', async () => {
  mocks.saveSettings.mockRejectedValueOnce(new Error('disk unavailable'))
  render(<MarketEvidenceMonitorPage />)
  await screen.findAllByText('Demand has provisional control')
  fireEvent.click(screen.getByRole('button', { name: 'Monitor settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Settings were not saved. disk unavailable')
  expect(screen.getByRole('form', { name: 'Monitor settings' })).toBeTruthy()
})

it('does not label a disconnected backend as active', async () => {
  mocks.status.mockRejectedValueOnce(new Error('offline'))
  render(<MarketEvidenceMonitorPage />)
  await screen.findByText('Monitor connection unavailable')
  expect(screen.getByRole('button', { name: 'Retry status' })).toBeTruthy()
  expect(screen.queryByText('Background monitoring active')).toBeNull()
})

it('follows the global Chinese locale for current and previously stored evidence', async () => {
  await i18n.changeLanguage('zh')
  render(<MarketEvidenceMonitorPage />)
  expect(await screen.findByText('市场证据监测')).toBeTruthy()
  expect(screen.getByText('每日市场简报')).toBeTruthy()
  expect(screen.getByText('短期、中期和长期证据一致偏多。')).toBeTruthy()
  expect(screen.getByText('威科夫结构')).toBeTruthy()
  expect(screen.getAllByText('上涨阶段候选').length).toBeGreaterThan(0)
  expect(screen.getByText('强势信号（SOS）')).toBeTruthy()
  expect(screen.getAllByText('需求暂时占优').length).toBeGreaterThan(0)
  expect(screen.getByText('收盘价位于60日区间的 82%。')).toBeTruthy()
  expect(screen.getAllByText('确认条件').length).toBeGreaterThan(0)
  expect(screen.getByRole('table', { name: '数据源可靠性' })).toBeTruthy()
  expect(screen.queryByText('Demand has provisional control')).toBeNull()
})

it('keeps old stored observations readable and asks for one new scan', async () => {
  const { trend: _trend, wyckoff: _wyckoff, dailyBrief: _dailyBrief, ...oldSnapshot } = demoMonitorSnapshot('BTC')
  mocks.snapshots.mockResolvedValue({ snapshots: [oldSnapshot], count: 1 })
  render(<MarketEvidenceMonitorPage />)
  await screen.findAllByText('Demand has provisional control')
  expect(screen.getAllByText(/Run a new scan to create multi-timeframe and Wyckoff analysis/)).toHaveLength(2)
  expect(mocks.scan).not.toHaveBeenCalled()
})

it('shows scoring limits, closed-bar dates and precise derivative units together', async () => {
  mocks.snapshots.mockImplementation(async (asset: 'BTC' | 'TSLA' | 'MSTR') => {
    const snapshot = demoMonitorSnapshot(asset)
    snapshot.context = { fundingRate: 0.00007141, openInterest: 790265750, optionOpenInterest: 433850.1 }
    snapshot.wyckoff!.confidence = 75
    snapshot.analysisBasis!.dailyAt = '2026-09-16'
    return { snapshots: [snapshot], count: 1 }
  })
  render(<MarketEvidenceMonitorPage />)
  expect(await screen.findByText('0.007141%')).toBeTruthy()
  expect(screen.getByText('790,265,750 USD')).toBeTruthy()
  expect(screen.getByText('433,850.1 BTC')).toBeTruthy()
  expect(screen.getByText('Rule score 75/100')).toBeTruthy()
  expect(screen.getByText(/Analysis uses closed bars: daily 2026-09-16/)).toBeTruthy()
  expect(screen.getByText(/Rule scores are not probabilities/)).toBeTruthy()
})

it('refreshes evaluation when the latest observation changes while history length stays fixed', async () => {
  let revision = 0
  mocks.snapshots.mockImplementation(async (asset: 'BTC' | 'TSLA' | 'MSTR') => ({ snapshots: [demoMonitorSnapshot(asset, revision)], count: 1 }))
  render(<MarketEvidenceMonitorPage />)
  await waitFor(() => expect(mocks.evaluation).toHaveBeenCalledWith('BTC'))
  const before = mocks.evaluation.mock.calls.length
  revision = 1
  mocks.scan.mockResolvedValueOnce({ snapshot: demoMonitorSnapshot('BTC', 1), stored: true, alert: null, receipt: {} })
  fireEvent.click(screen.getByRole('button', { name: /Scan now/ }))
  await waitFor(() => expect(mocks.evaluation.mock.calls.length).toBeGreaterThan(before))
})
