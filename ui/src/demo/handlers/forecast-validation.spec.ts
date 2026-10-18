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
    expect(report).toMatchObject({ asset, protocol: 'market-forward-v4', illustrative: true })
    expect(report.latest.publication.combined.protocol).toBe('evidence-summary-v3')
    expect(report.latest.publication.basis.strategyVersion).toBe(4)
    expect(report.validation.current.cohort.strategyVersion).toBe(4)
    expect(report.latest.candidate.decisions.short).toMatchObject({ choice: null, reasons: ['flat-inflated'] })
    expect(report.validation.current.summaries[0].jevDiagnostics).toMatchObject({ protocol: 'jev-abstention-audit-v1', reasonCountsOverlap: true,
      published: { guardedAbstained: 1, reasonCounts: { 'flat-inflated': 1 } }, matured: { raw: { scored: 0, accuracy: null } } })
    expect(report.rows[0].outcomes[0].jevDiagnostics).toMatchObject({ rawChoice: 'flat', rawCorrect: null })
  }
})
it('validates asset selection on both read and explicit collection routes', async () => {
  const read = await fetch(`${window.location.origin}/api/market-monitor/forecast-validation?asset=BAD`)
  expect(read.status).toBe(400)
  const write = await fetch(`${window.location.origin}/api/market-monitor/forecast-validation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset: 'BAD' }) })
  expect(write.status).toBe(400)
  const collect = await fetch(`${window.location.origin}/api/market-monitor/forecast-validation`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset: 'BTC' }) })
  expect(collect.status).toBe(200)
  expect(await collect.json()).toMatchObject({ illustrative: true, id: 'demo-market-forward-v4' })
})
it('keeps previous guarded results readable and rejects attempts to collect them', async () => {
  const root = `${window.location.origin}/api/market-monitor/forecast-validation`
  const legacy = await fetch(`${root}?asset=TSLA&protocol=market-forward-v2`)
  expect(await legacy.json()).toMatchObject({ protocol: 'market-forward-v2', illustrative: true, latest: { publication: { basis: { strategyVersion: 2 } } } })
  const previous = await fetch(`${root}?asset=TSLA&protocol=market-forward-v3`)
  expect(await previous.json()).toMatchObject({ protocol: 'market-forward-v3', latest: { publication: { basis: { strategyVersion: 3 } } } })
  const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  expect((await post(`${root}?protocol=market-forward-v2`, { asset: 'TSLA' })).status).toBe(400)
  expect((await post(root, { asset: 'TSLA', protocol: 'market-forward-v2' })).status).toBe(400)
})
