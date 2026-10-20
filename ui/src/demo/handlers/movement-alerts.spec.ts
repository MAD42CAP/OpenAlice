// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { movementAlertHandlers } from './movement-alerts'
const server = setupServer(...movementAlertHandlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
const url = `${window.location.origin}/api/market-monitor/movement-alerts`
const post = (path: string, body: unknown) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
it('reads illustrative conditional structure for each asset without creating alerts', async () => {
  for (const asset of ['BTC', 'TSLA', 'MSTR']) {
    const response = await fetch(`${url}?asset=${asset}`), report = await response.json()
    expect(response.status).toBe(200); expect(report).toMatchObject({ asset, illustrative: true, plans: [], risk: { protocol: 'market-movement-risk-v1' } })
    expect(report.risk.horizons[0].downside.boundary.dailyCloseConfirmed).toBeNull()
  }
})
it('freezes a two-sided plan, rejects duplicate active plans and cancels without triggering', async () => {
  const created = await post(url, { asset: 'BTC', upPercent: 3, downPercent: 3, expiresInHours: 24 }), report = await created.json(), plan = report.plans[0]
  expect(created.status).toBe(200); expect(plan).toMatchObject({ anchor: { price: 81123.45 }, up: { state: 'armed' }, down: { state: 'armed' } }); expect(plan.up.targetPrice).toBeCloseTo(81123.45 * 1.03); expect(plan.down.targetPrice).toBeCloseTo(81123.45 * .97)
  expect((await post(url, { asset: 'BTC', downPercent: 4, expiresInHours: 24 })).status).toBe(409)
  const read = await (await fetch(`${url}?asset=BTC`)).json(); expect(read.plans[0].anchor).toEqual(plan.anchor); expect(read.plans[0].up.event).toBeNull()
  const cancelled = await (await post(`${url}/${plan.id}/cancel`, { asset: 'BTC' })).json()
  expect(cancelled.plans[0].up.state).toBe('cancelled'); expect(cancelled.plans[0].down.event).toBeNull()
})
it('rejects invalid selections and unsupported thresholds or cancellation IDs', async () => {
  expect((await fetch(`${url}?asset=BAD`)).status).toBe(400)
  expect((await post(url, { asset: 'BTC', upPercent: 51, expiresInHours: 24 })).status).toBe(400)
  expect((await post(url, { asset: 'BTC', expiresInHours: 24 })).status).toBe(400)
  expect((await post(`${url}/missing/cancel`, { asset: 'TSLA' })).status).toBe(404)
})
