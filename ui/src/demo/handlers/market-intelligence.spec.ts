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
    expect(report.investment.nativeForward).toMatchObject({ protocol: 'native-investment-forward-v1', asset: 'BTC', invalidRecords: 0, orphanedRecords: 0 })
    expect(report.investment.nativeForward.current.summaries[0]).toMatchObject({ pending: 1, uniqueWindows: 0, unconditional: { scored: 0 }, conditionalIntent: { scored: 0 } })
    expect(report.research.reports.some((row: Record<string, unknown>) => 'text' in row || 'paragraphs' in row)).toBe(false)
  }
})

it.each(['TSLA', 'MSTR'])('serves %s native synthesis without fabricating Glassnode research', async asset => {
  const path = `${window.location.origin}/api/market-monitor/intelligence`
  const response = await fetch(`${path}?asset=${asset}`)
  const report = await response.json()
  expect(response.status).toBe(200); expect(report.illustrative).toBe(true); expect(report.asset).toBe(asset)
  expect(report.research).toMatchObject({ reports: [], snapshots: [], latest: null })
  expect(report.investment.latest).toMatchObject({ asset, researchSnapshotId: null, analysisVersion: 'investment-intelligence-equity-v2' })
  expect(report.investment.latest.evidence.every((row: { asset: string }) => row.asset === asset)).toBe(true)
  expect(report.investment.nativeForward.asset).toBe(asset)
  expect(report.investment.nativeForward.rows[0].outcomes.every((row: { status: string; intentKind: string; actual: unknown }) => row.status === 'pending' && row.intentKind === 'abstain' && row.actual === null)).toBe(true)
  expect((await fetch(`${path}/run?asset=${asset}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"force":true}' })).status).toBe(200)
  expect((await fetch(`${path}/discover?asset=${asset}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(400)
})
it('rejects unsupported assets instead of returning a BTC archive', async () => {
  expect((await fetch(`${window.location.origin}/api/market-monitor/intelligence?asset=ETH`)).status).toBe(400)
})
it('binds illustrative causes to their publications and preserves raw versus effective choices', async () => {
  const causes = new Set<string>()
  for (const asset of ['BTC', 'TSLA', 'MSTR']) {
    const response = await fetch(`${window.location.origin}/api/market-monitor/intelligence?asset=${asset}`)
    const report = await response.json(), snapshot = report.investment.latest, explanation = report.investment.explanation
    expect(explanation).toMatchObject({ protocol: 'investment-explanation-v1', asset, snapshotId: snapshot.id, marketSnapshotId: snapshot.marketSnapshotId, analysisTime: snapshot.analysisTime, inputStatus: 'verified' })
    for (const row of explanation.outlooks) {
      expect(row.direction).toBe(snapshot.outlooks.find((value: { horizon: string }) => value.horizon === row.horizon).direction)
      expect(row.rawDirection).toBe(snapshot.rawDraft.outlooks.find((value: { horizon: string }) => value.horizon === row.horizon).direction)
      causes.add(row.primaryReason)
    }
    if (asset === 'BTC') expect(explanation.outlooks[1]).toMatchObject({ direction: 'uncertain', rawDirection: 'neutral', primaryReason: 'same-horizon-conflict' })
    if (asset === 'MSTR') expect(explanation.outlooks[2]).toMatchObject({ direction: 'uncertain', rawDirection: 'uncertain', primaryReason: 'model-uncertain' })
  }
  expect([...causes]).toEqual(expect.arrayContaining(['data-unavailable', 'same-horizon-conflict', 'independent-confirmation-missing', 'model-uncertain']))
})
