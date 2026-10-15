import { afterAll, beforeAll, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { marketIntelligenceHandlers } from './market-intelligence'
const server = setupServer(...marketIntelligenceHandlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
it('serves explicit illustrative layers and all action routes without a real model call', async () => {
  for (const action of ['', '/discover', '/import', '/run']) {
    const response = await fetch(`${window.location.origin}/api/market-monitor/intelligence${action}`, action ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : undefined)
    const report = await response.json()
    expect(response.status).toBe(200); expect(report.illustrative).toBe(true); expect(report.asset).toBe('BTC')
    expect(report.research.latest.evidence.length).toBeGreaterThan(0); expect(report.investment.latest.outlooks).toHaveLength(3)
    expect(report.research.reports.some((row: Record<string, unknown>) => 'text' in row || 'paragraphs' in row)).toBe(false)
  }
})
