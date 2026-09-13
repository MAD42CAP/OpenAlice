// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { demoMonitorHealth } from '../../demo/fixtures/market-monitor'
import { MonitorOperations } from './MonitorOperations'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('exports the displayed report with its asset, window and source issues intact', async () => {
  const report = demoMonitorHealth('TSLA', 72)
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:report')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }))
  let filename = ''
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download })
  render(<MonitorOperations asset="TSLA" hours={72} onHoursChange={vi.fn()} report={report} error={null} loading={false} onRefresh={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Export report' }))
  expect(filename).toBe('market-health-tsla-72h.json')
  const content = await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsText(createObjectURL.mock.calls[0][0])
  })
  expect(JSON.parse(content)).toEqual(report)
  expect(screen.getByText('1 / 3 checked')).toBeTruthy()
  expect(screen.getByText(/not continuous uptime/)).toBeTruthy()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:report')
})

it('labels retained reports and sample limits, and does not invent legacy source checks', () => {
  const report = demoMonitorHealth('BTC')
  report.window.truncated = true
  report.summary.scansWithSourceChecks = 0
  report.summary.scansWithSourceIssues = 0
  report.sources = []
  render(<MonitorOperations asset="BTC" hours={24} onHoursChange={vi.fn()} report={report} error="offline" loading={false} onRefresh={vi.fn()} />)
  expect(screen.getByText(/Last successful report retained/)).toBeTruthy()
  expect(screen.getByText(/earlier attempts in this window are excluded/)).toBeTruthy()
  expect(screen.getByText('Source health is unknown for these attempts.')).toBeTruthy()
  expect(screen.getByText(/3 attempts have no source checks/)).toBeTruthy()
})
