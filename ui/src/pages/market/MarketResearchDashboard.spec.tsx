// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { i18n } from '../../i18n'
import { demoMarketDashboard } from '../../demo/fixtures/market-dashboard'
import { dashboardChartRows, dashboardEventAt, orderedDashboardEvents, formatDashboardValue, MarketResearchPanels } from './MarketResearchDashboard'

// Give Recharts a real layout box in jsdom without changing chart semantics.
vi.mock('recharts', async importOriginal => {
  const original = await importOriginal<typeof import('recharts')>()
  return { ...original, ResponsiveContainer: ({ children }: { children: ReactNode }) => <original.ResponsiveContainer width={600} height={240}>{children}</original.ResponsiveContainer> }
})
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)
const props = () => ({ asset: 'BTC' as const, days: 90 as const, onDaysChange: vi.fn(), report: demoMarketDashboard('BTC'), loading: false, failed: false, onRefresh: vi.fn(), onSelectSnapshot: vi.fn() })

it('separates missing values from zero, exposes provenance and links original judgments', () => {
  const input = props()
  render(<MarketResearchPanels {...input} />)
  expect(screen.getByText('Illustrative demo data · not live market observations')).toBeTruthy()
  expect(screen.getByText('200 周均线').parentElement?.textContent).toContain('—')
  expect(screen.getByRole('link', { name: 'Alternative.me · demo' }).getAttribute('href')).toContain('alternative.me')
  expect(screen.getAllByText('deribit-funding-8h-v1').length).toBeGreaterThan(0)
  expect(screen.getAllByText(/Data as of/).length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: 'Review original inputs' }))
  expect(input.onSelectSnapshot).toHaveBeenCalledWith('demo-btc-0')
  fireEvent.click(screen.getByRole('button', { name: '365 days' }))
  expect(input.onDaysChange).toHaveBeenCalledWith(365)
  expect(formatDashboardValue(null, 'percent')).toBe('—')
  expect(formatDashboardValue(0, 'percent')).toBe('0%')
  expect(formatDashboardValue(0.0025, 'percent')).toBe('0.0025%')
})

it('breaks a missing interval without synthesizing values or converting it to zero', () => {
  const series = demoMarketDashboard('BTC').modules[1].series[0]
  const rows = dashboardChartRows([series])
  expect(rows.filter(row => row[series.id] == null)).toHaveLength(1)
  expect(rows.filter(row => row[series.id] != null)).toHaveLength(series.points.length)
  expect(rows.some(row => row[series.id] === 0)).toBe(false)
})

it('keeps STRC separate and preserves the mNAV definition version', () => {
  render(<MarketResearchPanels {...props()} asset="MSTR" report={demoMarketDashboard('MSTR')} />)
  expect(screen.getByRole('heading', { name: 'STRC 优先股' })).toBeTruthy()
  expect(screen.getByRole('img', { name: /Relative performance/ })).toBeTruthy()
  expect(screen.getAllByText('strategy-mnav-2026-07-23').length).toBeGreaterThan(0)
  expect(screen.getAllByText('MSTR share price / Net Bitcoin Per Share (USD)').length).toBeGreaterThan(0)
  expect(screen.getByText('每股净含币量').parentElement?.textContent).toContain('—')
})

it('shows loading and a retryable error without substituting a report', () => {
  const input = props()
  const view = render(<MarketResearchPanels {...input} report={null} loading />)
  expect(screen.getByRole('status').textContent).toContain('Loading')
  view.rerender(<MarketResearchPanels {...input} report={null} failed />)
  expect(screen.getByRole('alert').textContent).toContain('refresh failed')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(input.onRefresh).toHaveBeenCalledOnce()
})

it('follows the global Chinese locale for the dashboard controls', async () => {
  await i18n.changeLanguage('zh')
  render(<MarketResearchPanels {...props()} />)
  expect(screen.getByRole('heading', { name: '研究图表与判断时间线' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '90 天' }).getAttribute('aria-pressed')).toBe('true')
})


it('orders dividends by their payment date, keeps upcoming first, and does not backdate judgments', () => {
  const captured = '2026-09-18T12:00:00Z'
  const payment = (id: string, at: string) => ({ id, at, availableAt: captured, kind: 'dividend' as const, label: id })
  const judgment = { id: 'judgment', at: '2026-09-01', availableAt: '2026-09-10T12:00:00Z', kind: 'wyckoff' as const, label: 'test' }
  const events = orderedDashboardEvents([payment('old', '2026-08-31'), payment('next', '2026-09-30'), payment('last', '2026-09-15'), judgment], captured)
  expect(events.map(event => event.id)).toEqual(['next', 'last', 'judgment', 'old'])
  expect(dashboardEventAt(events[0])).toBe('2026-09-30')
  expect(dashboardEventAt(judgment)).toBe('2026-09-10T12:00:00Z')
})


it('keeps weekly lines visible over daily prices without inventing daily weekly observations', () => {
  const report = demoMarketDashboard('BTC')
  const daily = report.modules[0].series[0]
  const start = '2026-09-01', end = '2026-09-08'
  daily.points = [{ at: start, value: 100 }, { at: '2026-09-02', value: 110 }, { at: end, value: 120 }]
  daily.maxGapMs = 8 * 86_400_000
  report.modules = [{ ...report.modules[0], series: [daily, { ...daily, id: 'weekly', label: 'Weekly average', points: [{ at: start, value: 90 }, { at: end, value: 95 }], maxGapMs: 7 * 86_400_000 }] }]
  const view = render(<MarketResearchPanels {...props()} report={report} />)
  const curves = view.container.querySelectorAll('.recharts-line-curve')
  expect(curves).toHaveLength(2)
  expect(curves[1].getAttribute('d')).toContain('L')
  expect(report.modules[0].series[1].points).toHaveLength(2)
})


it('preserves UTC calendar days for mixed ISO weekly/daily and sentiment series while keeping intraday instants local', () => {
  const NativeDateTimeFormat = Intl.DateTimeFormat
  const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locales, options) {
    return new NativeDateTimeFormat(locales, { ...options, timeZone: options?.timeZone ?? 'America/Vancouver' })
  })
  try {
    const report = demoMarketDashboard('BTC')
    const daily = report.modules[0].series[0]
    daily.points = [{ at: '2026-09-10', value: 100 }, { at: '2026-09-17', value: 120 }]
    daily.maxGapMs = 8 * 86_400_000
    report.modules[0].series.push({ ...daily, id: 'weekly', label: 'Weekly average', timeAxis: 'utc-date', points: [{ at: '2026-09-10T00:00:00Z', value: 90 }, { at: '2026-09-17T00:00:00Z', value: 95 }] })
    const sentiment = report.modules[2].series[0]
    sentiment.timeAxis = 'utc-date'
    sentiment.points = [{ at: '2026-09-17T00:00:00Z', value: 50 }]
    const funding = report.modules[1].series[0]
    funding.timeAxis = 'instant'
    funding.points = [{ at: '2026-09-17T00:00:00Z', value: 0.005 }]
    report.modules[1].series = [funding]
    render(<MarketResearchPanels {...props()} report={report} />)
    expect(screen.getByRole('img', { name: /BTC price & structure.*Sep 17/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /恐惧与贪婪指数.*Sep 17/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /8 小时资金费率.*Sep 16/ })).toBeTruthy()
  } finally {
    formatter.mockRestore()
  }
})
