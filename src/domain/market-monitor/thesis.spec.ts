import { describe, expect, it } from 'vitest'
import { judgmentSnapshot } from './judgment.fixture.js'
import { collectThesisEvidence, evaluateThesis } from './thesis.js'
import type { ThesisRevision } from './thesis-types.js'
import type { DashboardObservation } from './dashboard-types.js'

const now = new Date('2026-09-20T12:00:00Z')
const revision = (): ThesisRevision => ({ schemaVersion: 1, asset: 'BTC', revision: 1, createdAt: now.toISOString(), thesis: 'Synthetic thesis', horizon: 'One month', changeNote: 'Initial', enabled: true, recordHash: '', conditions: [
  { id: 'support', kind: 'support', label: 'Above floor', metric: 'daily-close', operator: 'gte', threshold: 101 },
  { id: 'risk', kind: 'invalidate', label: 'Above funding threshold', metric: 'funding-8h', operator: 'gt', threshold: 0.01 },
  { id: 'manual', kind: 'invalidate', label: 'Unverified text', metric: 'manual', operator: 'lt', threshold: null },
] })
const snapshot = () => { const s = judgmentSnapshot(); s.sourceHealth[2]!.id = 'btc-derivatives'; s.context.fundingRate = 0.0002; return s }

describe('thesis evidence checks', () => {
  it('converts fractional funding once and shows triggered invalidation alongside unknown text', () => {
    const s = snapshot(), original = structuredClone(s)
    const evaluation = evaluateThesis(revision(), collectThesisEvidence('BTC', s, [], now), now)
    expect(evaluation).toMatchObject({ status: 'triggered', supported: 1, triggered: 1, unknown: 1 })
    expect(evaluation.rows[1]!.evidence).toMatchObject({ value: 0.02, unit: 'percent', provider: 'test-provider' })
    expect(s).toEqual(original)
  })
  it('treats unavailable, retained and expired fields as unknown and zero as a real observation', () => {
    const s = snapshot(); s.context.fundingRate = 0
    expect(collectThesisEvidence('BTC', s, [], now).find(e => e.metric === 'funding-8h')).toMatchObject({ value: 0, reason: 'available' })
    s.sourceHealth[2]!.retained = { asOf: now.toISOString(), expiresAt: now.toISOString(), fields: ['fundingRate'] }
    expect(evaluateThesis(revision(), collectThesisEvidence('BTC', s, [], now), now)).toMatchObject({ status: 'incomplete', triggered: 0, unknown: 2 })
    delete s.sourceHealth[2]!.retained
    const evidence = collectThesisEvidence('BTC', s, [], now)
    expect(evaluateThesis(revision(), evidence, new Date('2026-09-20T12:31:00Z')).rows[1]!.evidence.reason).toBe('stale')
    expect(evaluateThesis(revision(), evidence, new Date('2026-09-23')).supported).toBe(0)
  })
  it('does not substitute a live quote, mismatched series, wrong asset or future timestamp', () => {
    const s = snapshot(); s.chart.daily.at(-1)!.close = 102
    expect(collectThesisEvidence('BTC', s, [], now)[0]!.reason).not.toBe('available')
    expect(collectThesisEvidence('TSLA', s, [], now)[0]!.reason).toBe('missing')
    s.capturedAt = 'invalid'
    expect(collectThesisEvidence('BTC', s, [], now)[0]!.reason).toBe('invalid-time')
    s.capturedAt = '2026-09-21T00:00:00Z'
    expect(collectThesisEvidence('BTC', s, [], now)[0]!.reason).toBe('invalid-time')
  })
  it('never equates no trigger with a confirmed thesis and respects strict/inclusive boundaries', () => {
    const r = revision(), e = collectThesisEvidence('BTC', snapshot(), [], now)
    r.conditions = [r.conditions[0]!]
    expect(evaluateThesis(r, e, now).status).toBe('supported')
    r.conditions[0]!.operator = 'gt'
    expect(evaluateThesis(r, e, now).status).toBe('watch')
    r.conditions[0]!.kind = 'invalidate'
    expect(evaluateThesis(r, e, now).status).toBe('watch')
    r.enabled = false
    expect(evaluateThesis(r, e, now).status).toBe('paused')
  })
  it('requires issuer formula, unit and real data time, using newer failures over older healthy values', () => {
    const observation: DashboardObservation = { kind: 'research', asset: 'MSTR', strategyId: 'evidence-chain-v1', capturedAt: now.toISOString(), snapshotId: null,
      metrics: [{ id: 'strategy-mnav', label: 'mNAV', value: 2, unit: 'ratio', description: 'Synthetic', source: { provider: 'issuer-test', dataAt: now.toISOString(), fetchedAt: now.toISOString(), status: 'ok', formulaVersion: 'strategy-net-bps-2026-07-23' } }] }
    const read = (rows = [observation]) => collectThesisEvidence('MSTR', null, rows, now).find(e => e.metric === 'strategy-mnav')!
    expect(read()).toMatchObject({ value: 2, reason: 'available' })
    const failed = structuredClone(observation); failed.metrics[0]!.source.status = 'unavailable'
    expect(read([observation, failed]).reason).toBe('source-unavailable')
    observation.metrics[0]!.source.formulaVersion = 'old-definition'
    expect(read().reason).toBe('formula-changed')
    observation.metrics[0]!.source.formulaVersion = 'strategy-net-bps-2026-07-23'; observation.metrics[0]!.source.dataAt = null
    expect(read().reason).toBe('invalid-time')
  })
})
