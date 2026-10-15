// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { demoMarketIntelligence } from '../../demo/fixtures/market-intelligence'
import { MarketIntelligenceWorkspace } from './MarketIntelligenceWorkspace'
import { formatMonitorDate } from './market-monitor-format'
import { formatResearchDate, IntelligenceEvidence } from './MarketIntelligenceShared'
const api = vi.hoisted(() => ({ read: vi.fn(), discover: vi.fn(), importReport: vi.fn(), run: vi.fn() }))
vi.mock('../../api/market-intelligence', () => ({ marketIntelligenceApi: api }))
beforeEach(async () => { await i18n.changeLanguage('en'); api.read.mockImplementation(async () => demoMarketIntelligence()); api.discover.mockResolvedValue({}); api.importReport.mockResolvedValue({}); api.run.mockResolvedValue({}) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
function renderView() { return render(<MarketIntelligenceWorkspace asset="BTC" visible revisionKey="first"><label>My market draft<input aria-label="My market draft" defaultValue="" /></label></MarketIntelligenceWorkspace>) }
async function select(name: string) { fireEvent.click(screen.getByRole('tab', { name })); await screen.findByRole('button', { name: 'Refresh archive' }) }

it('keeps the market view as the default and preserves drafts while switching research layers', async () => {
  renderView()
  expect(screen.getByRole('tab', { name: 'Market monitor' }).getAttribute('aria-selected')).toBe('true')
  fireEvent.change(screen.getByRole('textbox', { name: 'My market draft' }), { target: { value: 'Keep this private draft' } })
  await select('On-chain research')
  expect(screen.queryByRole('textbox', { name: 'My market draft' })).toBeNull()
  expect(screen.getByText('演示：成本附近存在承接线索，需求是否持续仍需观察。')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Analysis and evidence' }).getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(screen.getByRole('tab', { name: 'Market monitor' }))
  expect((screen.getByRole('textbox', { name: 'My market draft' }) as HTMLInputElement).value).toBe('Keep this private draft')
})
it('shows independent horizons and explains that evidence support is not a price forecast', async () => {
  renderView(); await select('AI synthesis')
  const region = screen.getByRole('region', { name: 'AI synthesis' })
  expect(within(region).getByText('Short term · 1–5 days')).toBeTruthy(); expect(within(region).getByText('Medium term · 1–4 weeks')).toBeTruthy(); expect(within(region).getByText('Long term · 1–6 months')).toBeTruthy()
  expect(within(region).getByText('Bearish')).toBeTruthy(); expect(within(region).getByText('Neutral')).toBeTruthy(); expect(within(region).getByText('Conditionally bullish')).toBeTruthy()
  expect(within(region).queryByRole('link', { name: /Illustrative research fixture/ })).toBeNull()
  expect(within(region).queryByText('演示成本证据不能替代价格突破确认。')).toBeNull()
  expect(screen.queryByText(/Newer input records are available/)).toBeNull()
  expect(screen.queryByText('演示：ETF 与流动性数据不可用。')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Input limitations' }))
  expect(screen.getByText('演示：ETF 与流动性数据不可用。')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Evidence alignment' }))
  expect(screen.getByText(/These statuses describe agreement/)).toBeTruthy()
  expect(screen.getAllByRole('link', { name: /Illustrative research fixture/ })[0].getAttribute('href')).toBe('https://research.glassnode.com/')
  expect(screen.queryByText('CONFIRMED')).toBeNull()
  expect(within(screen.getByRole('tabpanel', { name: 'AI synthesis' })).getByText('Illustrative research · not a real report or market judgment')).toBeTruthy()
})
it('shows explicit missing evidence and queues no work merely by viewing an empty archive', async () => {
  const report = demoMarketIntelligence(); report.market = null; report.research = { ...report.research, reports: [], snapshots: [], latest: null }; report.investment = { ...report.investment, latest: null, history: [], theses: [] }; api.read.mockResolvedValue(report)
  renderView(); await select('AI synthesis')
  expect(screen.getByText('Insufficient evidence for synthesis')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Rebuild synthesis' }) as HTMLButtonElement).disabled).toBe(true)
  expect(api.run).not.toHaveBeenCalled()
})
it('retains source import drafts on failure and while leaving the layer', async () => {
  api.importReport.mockRejectedValue(new Error('Source unavailable'))
  renderView(); await select('On-chain research')
  fireEvent.click(screen.getByRole('button', { name: 'Import a report' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Report URL' }), { target: { value: 'https://research.glassnode.com/' } })
  fireEvent.click(screen.getByRole('button', { name: 'Provide authorised text' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Report title' }), { target: { value: 'My authorised research' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Authorised report text' }), { target: { value: 'Authorised original source content' } })
  fireEvent.click(screen.getByRole('button', { name: 'Import text' }))
  expect(await within(screen.getByRole('tabpanel', { name: 'On-chain research' })).findByText('Report import failed: Source unavailable')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'Market monitor' })); await select('On-chain research')
  expect((screen.getByRole('textbox', { name: 'Authorised report text' }) as HTMLTextAreaElement).value).toBe('Authorised original source content')
  expect(api.importReport).toHaveBeenCalledWith({ url: 'https://research.glassnode.com/', title: 'My authorised research', text: 'Authorised original source content' })
})
it('marks a selected historical synthesis and returns to the latest saved result', async () => {
  renderView(); await select('AI synthesis')
  fireEvent.click(screen.getByRole('button', { name: 'Synthesis history' }))
  fireEvent.click(screen.getByRole('button', { name: formatMonitorDate('2026-10-14T18:05:00Z') }))
  expect(screen.getByText('Historical archive · not the current judgment')).toBeTruthy()
  expect(screen.getAllByText('演示前次综合观点：中性观察。').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: 'Latest saved analysis' }))
  expect(screen.queryByText('Historical archive · not the current judgment')).toBeNull()
})
it('shows refresh failure above retained records and actual queued job status after running', async () => {
  renderView(); await select('AI synthesis')
  api.read.mockRejectedValueOnce(new Error('Offline'))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh archive' }))
  expect(await within(screen.getByRole('tabpanel', { name: 'AI synthesis' })).findByText('Research refresh failed: Offline')).toBeTruthy()
  expect(within(screen.getByRole('tabpanel', { name: 'AI synthesis' })).getByText(/Previously saved research remains below/)).toBeTruthy()
  const queued = demoMarketIntelligence(); queued.job.state = 'queued'; api.read.mockResolvedValue(queued)
  fireEvent.click(screen.getByRole('button', { name: 'Rebuild synthesis' }))
  await waitFor(() => expect(api.run).toHaveBeenCalledWith(true))
  expect(await within(screen.getByRole('tabpanel', { name: 'AI synthesis' })).findByText('AI job · Queued')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Rebuild synthesis' }) as HTMLButtonElement).disabled).toBe(true)
})
it('does not add research controls or make research requests for equities', async () => {
  render(<MarketIntelligenceWorkspace asset="TSLA" visible revisionKey="stock"><p>Original equity content</p></MarketIntelligenceWorkspace>)
  expect(screen.getByText('Original equity content')).toBeTruthy(); expect(screen.queryByRole('tab')).toBeNull(); expect(api.read).not.toHaveBeenCalled()
})
it('shows a source-linked previous report without presenting it as the latest research', async () => {
  renderView(); await select('On-chain research')
  fireEvent.click(screen.getByRole('button', { name: 'Report and analysis history' }))
  fireEvent.click(screen.getByRole('button', { name: `${formatMonitorDate('2026-10-07T12:00:00Z')} · Revision 1` }))
  expect(screen.getByText('Historical archive · not the current judgment')).toBeTruthy()
  expect(screen.getByText('演示上期观点：需求尚弱。')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Latest saved analysis' }))
  expect(screen.queryByText('Historical archive · not the current judgment')).toBeNull()
})
it('exposes objective invalidation checks and their immutable status transition', async () => {
  const report = demoMarketIntelligence()
  const thesis = report.investment.theses[0]
  const evaluation = { id: 'evaluation-1', thesisId: thesis.id, thesisRevision: 1 as const, evaluatedAt: '2026-10-15T12:00:00Z', marketSnapshotId: 'later-market', previousStatus: 'ACTIVE' as const, status: 'INVALIDATED' as const, reason: 'Completed daily close crossed the predefined cost level.', rows: [{ kind: 'invalidate' as const, condition: thesis.invalidationConditions[0], value: 64000, result: 'met' as const, evidence: report.investment.latest!.evidence[0] }], evidence: report.investment.latest!.evidence, recordHash: 'fixture-evaluation' }
  thesis.status = 'INVALIDATED'; thesis.latestEvaluation = evaluation; report.investment.evaluations = [evaluation]
  api.read.mockResolvedValue(report)
  renderView(); await select('AI synthesis')
  fireEvent.click(screen.getByRole('button', { name: 'AI research theses' }))
  expect(screen.getByText(/AI-created tracked views are separate/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Condition checks and state changes' }))
  expect(screen.getByText(/Active → Invalidated/)).toBeTruthy()
  expect(screen.getByText('Met · 64000')).toBeTruthy()
  expect(screen.getByText('Condition checks are not a directional forecast win rate.')).toBeTruthy()
})
it('warns when the saved synthesis used earlier input records', async () => {
  const report = demoMarketIntelligence(); report.market!.snapshotId = 'newer-scan'; api.read.mockResolvedValue(report)
  renderView(); await select('AI synthesis')
  expect(screen.getByText(/Newer input records are available/)).toBeTruthy()
})
it('uses the shared tab keyboard selection and removes inactive content from accessibility', async () => {
  renderView()
  const market = screen.getByRole('tab', { name: 'Market monitor' })
  market.focus(); fireEvent.keyDown(market, { key: 'ArrowRight' })
  await waitFor(() => expect(screen.getByRole('tab', { name: 'On-chain research' }).getAttribute('aria-selected')).toBe('true'))
  expect(screen.queryByRole('textbox', { name: 'My market draft' })).toBeNull()
  const panel = document.querySelector('[data-slot="tabs-content"][aria-hidden="true"]')
  expect(panel?.hasAttribute('inert')).toBe(true)
})
it('preserves research calendar days when Vancouver local time is still on the preceding day', () => {
  const sourceDay = '2026-10-13T00:00:00.000Z'
  const vancouver = new Date(sourceDay).toLocaleString('en-US', { timeZone: 'America/Vancouver' })
  expect(vancouver).toMatch(/10\/12\/2026/)
  expect(formatResearchDate(sourceDay)).toBe('2026-10-13')
  expect(formatResearchDate('2026-10-13T00:00:00Z')).toBe('2026-10-13')
  const row = { ...demoMarketIntelligence().research.latest!.evidence[0], dataAsOf: sourceDay }
  render(<IntelligenceEvidence ids={[row.id]} evidence={[row]} />)
  expect(screen.getByRole('link').textContent).toContain('Data through 2026-10-13')
})
it.each(['investment-intelligence-v1', 'investment-intelligence-v2'] as const)('marks an unchanged %s synthesis as awaiting the revised safeguards', async version => {
  const report = demoMarketIntelligence(); report.investment.latest!.analysisVersion = version; report.investment.latest!.researchFeedback = undefined; api.read.mockResolvedValue(report)
  renderView(); await select('AI synthesis')
  expect(screen.getByText('Earlier synthesis · awaiting an update with the revised safeguards.')).toBeTruthy()
  expect(screen.queryByText('Revised synthesis under test · conditional evidence, not a verified forecast.')).toBeNull()
})
it('shows the saved v3 research review receipt without claiming predictive accuracy', async () => {
  api.read.mockResolvedValue(demoMarketIntelligence())
  renderView(); await select('AI synthesis')
  expect(screen.getByText(/Research reviewed · caution retained/)).toBeTruthy()
  expect(screen.getByText('Revised synthesis under test · conditional evidence, not a verified forecast.')).toBeTruthy()
})
