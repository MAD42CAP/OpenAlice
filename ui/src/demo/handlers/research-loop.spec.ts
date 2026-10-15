// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { researchLoopHandlers } from './research-loop'
const server = setupServer(...researchLoopHandlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
const path = () => `${window.location.origin}/api/market-monitor/research-loop`
it('serves explicit illustrative consumed and failed feedback without invoking research', async () => {
  const report = await (await fetch(`${path()}?asset=BTC`)).json()
  expect(report).toMatchObject({ asset: 'BTC', protocol: 'btc-research-loop-v1', illustrative: true })
  expect(report.context.hash).toBe(report.synthesis.contextHash)
  expect(report.contributors.filter((row: { state: string }) => row.state === 'ready')).toHaveLength(3)
  const failure = await (await fetch(`${path()}?scenario=failed`)).json()
  expect(failure.contributors[2].state).toBe('failed')
  expect(failure.synthesis).toBeNull()
})
it('uses the BTC-only API contract and makes run an illustrative no-op', async () => {
  expect((await fetch(`${path()}?asset=TSLA`)).status).toBe(400)
  const run = await fetch(`${path()}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  expect(run.status).toBe(200)
  expect((await run.json()).illustrative).toBe(true)
  expect((await fetch(`${path()}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"asset":"BTC"}' })).status).toBe(400)
})
