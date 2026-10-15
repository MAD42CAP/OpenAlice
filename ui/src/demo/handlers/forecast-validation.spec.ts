// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { typeSafeHandlers } from './typesafe'
const server = setupServer(...typeSafeHandlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
it('serves a versioned illustrative report and guarded decisions for each asset', async () => {
  for (const asset of ['BTC', 'TSLA', 'MSTR']) {
    const response = await fetch(`${window.location.origin}/api/market-monitor/forecast-validation?asset=${asset}`)
    const report = await response.json()
    expect(response.status).toBe(200)
    expect(report).toMatchObject({ asset, protocol: 'market-forward-v2', illustrative: true })
    expect(report.latest.publication.combined.protocol).toBe('evidence-summary-v2')
    expect(report.latest.candidate.decisions.short).toMatchObject({ choice: null, reasons: ['flat-inflated'] })
  }
})
it('validates asset selection on both read and explicit collection routes', async () => {
  const read = await fetch(`${window.location.origin}/api/market-monitor/forecast-validation?asset=BAD`)
  expect(read.status).toBe(400)
  const write = await fetch(`${window.location.origin}/api/market-monitor/forecast-validation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset: 'BAD' }) })
  expect(write.status).toBe(400)
  const collect = await fetch(`${window.location.origin}/api/market-monitor/forecast-validation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset: 'BTC' }) })
  expect(collect.status).toBe(200)
  expect(await collect.json()).toMatchObject({ illustrative: true, id: 'demo-forward-v2' })
})
