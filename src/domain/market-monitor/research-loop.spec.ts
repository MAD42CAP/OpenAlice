import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { judgmentSnapshot } from './judgment.fixture.js'
import { buildMarketIntelligence } from './intelligence-market.js'
import { buildGuardedMarketJudgment } from './judgment.js'
import { hashJevInput } from './typesafe-input.js'
import { forwardRecordHash } from './forecast-validation-store.js'
import { guardedJevDecision } from './forecast-validation-input.js'
import { FORWARD_PROTOCOL, JEV_DECISION_POLICY, type ForwardCandidate, type ForwardPublication, type ForwardReport } from './forecast-validation-types.js'
import { TYPESAFE_MODEL, type JevResult } from './typesafe-client.js'
import { createResearchLoop, researchFeedbackDraftSchema } from './research-loop.js'
import { researchLoopInputHash, researchLoopRecordHash } from './research-loop-store.js'
import { RESEARCH_LOOP_ISSUES, type ResearchFeedbackDraft, type ResearchLoopJob, type ResearchLoopRunner, type ResearchRole } from './research-loop-types.js'
import type { IntelligenceProvenance } from './intelligence-types.js'
import type { ReturnHistory } from './forecast-experiment-types.js'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'btc-research-loop-')); roots.push(root)
  let at = new Date('2026-09-20T12:05:00Z')
  const market = buildMarketIntelligence(judgmentSnapshot(), at)
  const history: ReturnHistory = { sessions: 1, samples: 100, firstEntryAt: '2026-01-01', lastExitAt: '2026-09-19', probabilities: { up: 0.5, flat: 0.1, down: 0.4 }, meanPercent: 0.2, medianAbsolutePercent: 1, volatilityPercent: 2 }
  const raw: JevResult = { model: TYPESAFE_MODEL, durationMs: 20, inputTokens: 1, answers: Object.fromEntries(['short', 'medium', 'long'].flatMap(h => [
    [h, { type: 'choice', choice: 'flat', confidence: 0.8, probabilities: { up: 0.1, flat: 0.8, down: 0.1 } }],
    [`${h}Evidence`, { type: 'choice', choice: 'adequate', confidence: 0.8, probabilities: { adequate: 0.8, insufficient: 0.2 } }],
    [`${h}Signal`, { type: 'choice', choice: 'uncertain', confidence: 0.8, probabilities: { supported: 0.2, uncertain: 0.8 } }],
  ])) }
  const publication: ForwardPublication = { schemaVersion: 1, protocol: FORWARD_PROTOCOL, id: 'forward-publication', asset: 'BTC', issuedAt: '2026-09-20T12:01:00Z',
    policy: { ...JEV_DECISION_POLICY, combinedProtocol: 'evidence-summary-v2', combinedDecisionPolicy: 'guarded-price-evidence-v2' },
    basis: { snapshotId: market.snapshotId, inputHash: 'archive', capturedAt: market.retrievedAt, strategyId: 'evidence-chain-v1', strategyVersion: 2, provider: 'test' },
    input: { state: { daily: { lastClosedAt: market.marketDataAsOf } }, questions: {}, history: { short: history, medium: history, long: history } }, inputHash: '', rules: { short: 'up', medium: 'up', long: 'up' }, combined: buildGuardedMarketJudgment(judgmentSnapshot(), at), recordHash: '' }
  publication.inputHash = hashJevInput(publication.input); publication.recordHash = forwardRecordHash(publication)
  const candidate: ForwardCandidate = { schemaVersion: 1, protocol: FORWARD_PROTOCOL, publicationId: publication.id, requestedAt: '2026-09-20T12:02:00Z', issuedAt: '2026-09-20T12:03:00Z', inputHash: publication.inputHash, raw,
    decisions: Object.fromEntries(['short', 'medium', 'long'].map(h => [h, guardedJevDecision(raw, h as 'short', history)])) as ForwardCandidate['decisions'], recordHash: '' }
  candidate.recordHash = forwardRecordHash(candidate)
  const forward: ForwardReport = { protocol: FORWARD_PROTOCOL, asset: 'BTC', configured: true, automatic: true, generatedAt: at.toISOString(), invalidRecords: 0, historyTruncated: false, lastError: null, latest: { publication, candidate }, rows: [], summaries: [] }
  const source = vi.fn(async () => ({ market, research: null, forward }))
  const status: Record<ResearchRole, ResearchLoopJob> = { prediction: { state: 'idle', message: 'Waiting', updatedAt: null, workspaceId: 'workspace-prediction', runId: null }, quant: { state: 'idle', message: 'Waiting', updatedAt: null, workspaceId: 'workspace-quant', runId: null } }
  const runner: ResearchLoopRunner = { ensure: vi.fn(async () => {}), status: vi.fn(async (role: ResearchRole) => status[role]), run: vi.fn(async (role: ResearchRole) => (status[role] = { ...status[role], state: 'running', runId: `run-${role}`, updatedAt: at.toISOString(), message: 'Running' })) }
  const published = vi.fn(async () => {})
  const service = createResearchLoop({ source, root, now: () => at, onPublished: published }); service.setRunner(runner)
  const provenance = (role: ResearchRole): IntelligenceProvenance => ({ workspaceId: `workspace-${role}`, runId: `run-${role}`, issueId: RESEARCH_LOOP_ISSUES[role], agent: 'codex' })
  const draft: ResearchFeedbackDraft = { summary: 'Price structure remains conditional; no independent return edge has been established.', horizon: 'short', conclusion: 'supports', supportingEvidenceIds: [market.evidence.find(e => e.metric === 'daily-close')!.id], opposingEvidenceIds: [], confirmation: 'A later completed close must retain the boundary.', invalidation: 'A later close breaks the observed boundary.', limitations: ['Overlapping windows and shared price evidence do not establish independence.'], recommendations: ['Keep the next forecast version unchanged until prospective outcomes mature.'] }
  return { root, market, forward, source, status, runner, published, service, provenance, draft, setAt: (value: string) => { at = new Date(value) } }
}

describe('BTC research feedback loop', () => {
  it('freezes exact per-run evidence and publishes immutable authenticated research with inference-only synthesis context', async () => {
    const f = await fixture(); await f.service.run()
    const p = f.provenance('prediction'), input = await f.service.nativeInput('prediction', p)
    expect(input.id).toMatch(/^loop-input-[a-f0-9]{64}$/)
    expect(input.evidence.some(e => e.metric === 'research-feedback.jev.short' && e.kind === 'inference' && e.value === 'abstain')).toBe(true)
    expect(input.forward.latest!.candidate!.raw.answers.short!.probabilities.flat).toBe(0.8)
    f.setAt('2026-09-20T12:06:00Z'); f.market.price = 102
    expect(await f.service.nativeInput('prediction', p)).toEqual(input)
    expect(input.market.price).toBe(101)
    const row = await f.service.publish(input.id, f.draft, p)
    const bytes = await readFile(join(f.root, 'feedback', `${row.id}.json`), 'utf8')
    expect((await stat(join(f.root, 'feedback', `${row.id}.json`))).mode & 0o777).toBe(0o600)
    expect(await f.service.publish(input.id, f.draft, p)).toEqual(row)
    await expect(f.service.publish(input.id, { ...f.draft, summary: 'Changed' }, p)).rejects.toThrow(/不能覆盖/)
    expect(await readFile(join(f.root, 'feedback', `${row.id}.json`), 'utf8')).toBe(bytes)
    const context = await f.service.context()
    expect(context.records).toHaveLength(1)
    expect(context.evidence.every(e => e.kind === 'inference' && e.reportId === null && typeof e.value === 'string')).toBe(true)
    expect(context.jev).toMatchObject({ publicationId: 'forward-publication', candidateHash: f.forward.latest!.candidate!.recordHash, decisions: { short: { choice: null, reasons: ['signal-uncertain', 'flat-inflated'] } } })
    expect(f.published).toHaveBeenCalledOnce()
    f.status.prediction.state = 'success'
    expect((await f.service.report()).contributors.find(c => c.source === 'prediction')).toMatchObject({ state: 'ready', recordId: row.id })
  })

  it('rejects other issues, wrong workspaces, wrong runs and stopped callers before input or publication', async () => {
    const f = await fixture(), p = f.provenance('prediction')
    await expect(f.service.nativeInput('prediction', p)).rejects.toThrow(/身份/)
    await f.service.run()
    for (const changed of [{ issueId: RESEARCH_LOOP_ISSUES.quant }, { workspaceId: 'other' }, { runId: 'other' }]) await expect(f.service.nativeInput('prediction', { ...p, ...changed })).rejects.toThrow()
    const input = await f.service.nativeInput('prediction', p)
    await expect(f.service.publish(input.id, f.draft, f.provenance('quant'))).rejects.toThrow()
    f.status.prediction.state = 'success'
    await expect(f.service.publish(input.id, f.draft, p)).rejects.toThrow(/身份/)
  })

  it('rejects uncited directional conclusions, non-frozen and future/unavailable evidence without saving', async () => {
    const f = await fixture(); await f.service.run()
    const p = f.provenance('quant'), input = await f.service.nativeInput('quant', p)
    await expect(f.service.publish(input.id, { ...f.draft, supportingEvidenceIds: [] }, p)).rejects.toThrow()
    await expect(f.service.publish(input.id, { ...f.draft, supportingEvidenceIds: ['invented'] }, p)).rejects.toThrow(/冻结输入/)
    const unavailable = input.evidence.find(e => e.quality !== 'available')!
    await expect(f.service.publish(input.id, { ...f.draft, supportingEvidenceIds: [unavailable.id] }, p)).rejects.toThrow(/冻结输入/)
    const changed = structuredClone(input); changed.evidence[0]!.retrievedAt = '2026-09-21T12:00:00Z'; changed.hash = researchLoopInputHash(changed)
    await writeFile(join(f.root, 'inputs', `${input.id}.json`), JSON.stringify(changed))
    await expect(f.service.publish(input.id, f.draft, p)).rejects.toThrow(/冻结来源/)
    expect((await f.service.report()).history).toHaveLength(0)
  })

  it('does not accept mutated input content even when the outer hash is recomputed', async () => {
    const f = await fixture(); await f.service.run()
    const p = f.provenance('prediction'), input = await f.service.nativeInput('prediction', p)
    input.provenance.runId = 'other'; input.hash = researchLoopInputHash(input)
    await writeFile(join(f.root, 'inputs', `${input.id}.json`), JSON.stringify(input))
    await expect(f.service.publish(input.id, f.draft, p)).rejects.toThrow(/输入无效/)
  })

  it('expires research at 24 hours and suppresses changed completed-daily bases, retaining history', async () => {
    const f = await fixture(); await f.service.run()
    const p = f.provenance('prediction'), input = await f.service.nativeInput('prediction', p)
    await f.service.publish(input.id, f.draft, p); f.status.prediction.state = 'success'
    f.market.marketDataAsOf = '2026-09-18'
    expect((await f.service.context()).records).toHaveLength(0)
    await expect(f.service.publish(input.id, f.draft, p)).rejects.toThrow()
    f.market.marketDataAsOf = '2026-09-19'; f.setAt('2026-09-21T12:05:00Z')
    const report = await f.service.report()
    expect(report.context.records).toHaveLength(0); expect(report.history).toHaveLength(1)
    expect(report.contributors.find(c => c.source === 'prediction')?.state).toBe('stale')
    await expect(f.service.nativeInput('prediction', p)).rejects.toThrow()
  })

  it('never promotes stale, mismatched, future or policy-forged Jev output to current context', async () => {
    const f = await fixture(); expect((await f.service.context()).jev).not.toBeNull()
    f.setAt('2026-09-21T00:01:00Z'); expect((await f.service.context()).jev).toBeNull()
    f.setAt('2026-09-20T12:05:00Z'); f.forward.latest!.candidate!.inputHash = 'other'
    f.forward.latest!.candidate!.recordHash = forwardRecordHash(f.forward.latest!.candidate!)
    expect((await f.service.context()).jev).toBeNull()
    f.forward.latest!.candidate!.inputHash = f.forward.latest!.publication.inputHash
    f.forward.latest!.candidate!.decisions.short.choice = 'flat'; f.forward.latest!.candidate!.recordHash = forwardRecordHash(f.forward.latest!.candidate!)
    expect((await f.service.context()).jev).toBeNull()
  })

  it('expires current research when its original hourly citation ages out, even before the 24-hour cap', async () => {
    const f = await fixture(); await f.service.run()
    const p = f.provenance('prediction'), input = await f.service.nativeInput('prediction', p)
    const hourly = input.evidence.find(e => e.metric === 'hourly-close')!
    await f.service.publish(input.id, { ...f.draft, supportingEvidenceIds: [hourly.id] }, p)
    f.status.prediction.state = 'success'
    expect((await f.service.context()).records).toHaveLength(1)
    f.setAt('2026-09-20T15:01:00Z')
    const report = await f.service.report()
    expect(report.context.records).toHaveLength(0); expect(report.history).toHaveLength(1)
    expect(report.contributors.find(c => c.source === 'prediction')?.state).toBe('stale')
  })

  it('keeps context identity stable over quote/read times and task status changes', async () => {
    const f = await fixture(); await f.service.run()
    const p = f.provenance('prediction'), input = await f.service.nativeInput('prediction', p)
    await f.service.publish(input.id, f.draft, p)
    const first = await f.service.context()
    f.setAt('2026-09-20T12:10:00Z'); f.market.analysisTime = '2026-09-20T12:10:00Z'; f.status.quant.message = 'Progress'; f.status.prediction.state = 'success'
    expect((await f.service.context()).hash).toBe(first.hash)
    expect((await f.service.context()).asOf).toBe(first.asOf)
  })

  it('freezes and validates after asynchronous source acquisition, including native publication', async () => {
    const f = await fixture(); let next = Date.parse('2026-09-20T12:05:00Z')
    f.source.mockImplementation(async () => {
      next += 15; const value = new Date(next).toISOString()
      f.setAt(value); f.market.analysisTime = value
      return { market: f.market, research: null, forward: f.forward }
    })
    await f.service.run()
    const p = f.provenance('prediction'), input = await f.service.nativeInput('prediction', p)
    expect(input.capturedAt).toBe(input.market.analysisTime)
    await f.service.publish(input.id, f.draft, p)
    expect((await f.service.context()).records).toHaveLength(1)
    expect((await f.service.context()).jev).not.toBeNull()
  })

  it('coalesces dispatch, reuses ready same-basis research and permits one explicit retry of a failed run', async () => {
    const f = await fixture(); await Promise.all([f.service.run(), f.service.run()])
    expect(f.runner.run).toHaveBeenCalledTimes(2)
    const p = f.provenance('prediction'), input = await f.service.nativeInput('prediction', p)
    await f.service.publish(input.id, f.draft, p); f.status.prediction.state = 'success'
    f.status.quant.state = 'failed'; f.status.quant.message = 'Canceled by runtime'
    await f.service.run()
    expect(f.runner.run).toHaveBeenCalledTimes(3)
    expect(vi.mocked(f.runner.run).mock.calls.at(-1)?.[0]).toBe('quant')
  })

  it('marks a completed run without an artifact failed and does not treat failed/canceled jobs as success', async () => {
    const f = await fixture(); await f.service.run(); f.status.prediction.state = 'success'; f.status.quant.state = 'failed'
    const report = await f.service.report()
    expect(report.contributors.find(c => c.source === 'prediction')).toMatchObject({ state: 'failed', recordId: null, summary: expect.stringContaining('没有发布') })
    expect(report.contributors.find(c => c.source === 'quant')?.state).toBe('failed')
  })

  it('isolates one role dispatch failure and exposes a safe error while the other role runs', async () => {
    const f = await fixture()
    vi.mocked(f.runner.run).mockRejectedValueOnce(new Error('private native launch details'))
    const report = await f.service.run()
    expect(report.contributors.find(c => c.source === 'prediction')).toMatchObject({ state: 'failed', summary: expect.stringContaining('未能启动') })
    expect(report.contributors.find(c => c.source === 'quant')?.state).toBe('running')
    expect(JSON.stringify(report)).not.toContain('private native')
    await f.service.run()
    expect(f.runner.run).toHaveBeenCalledTimes(3)
  })

  it('preserves a saved record when downstream synthesis fails and counts corruption without overwriting', async () => {
    const f = await fixture(); f.published.mockRejectedValueOnce(new Error('native runtime unavailable')); await f.service.run()
    const p = f.provenance('prediction'), input = await f.service.nativeInput('prediction', p), row = await f.service.publish(input.id, f.draft, p)
    expect((await f.service.report()).history).toHaveLength(1)
    row.validation = 'verified' as 'unvalidated'; row.recordHash = researchLoopRecordHash(row)
    const file = join(f.root, 'feedback', `${row.id}.json`); await writeFile(file, JSON.stringify(row))
    const report = await f.service.report(); expect(report.invalidRecords).toBe(1); expect(report.context.records).toHaveLength(0)
    expect(await readFile(file, 'utf8')).toContain('verified')
  })

  it('blocks current context when input source is unavailable, keeping historical artifacts visible', async () => {
    const f = await fixture(); await f.service.run()
    const p = f.provenance('prediction'), input = await f.service.nativeInput('prediction', p); await f.service.publish(input.id, f.draft, p)
    f.source.mockRejectedValue(new Error('source unavailable'))
    const report = await f.service.report()
    expect(report.context.records).toHaveLength(0); expect(report.context.jev).toBeNull(); expect(report.history).toHaveLength(1)
    expect(report.contributors.every(c => c.state === 'blocked')).toBe(true)
  })

  it('rejects secret-like submissions generically without returning their contents', () => {
    const f = { summary: 'Safe', horizon: 'short', conclusion: 'inconclusive', supportingEvidenceIds: [], opposingEvidenceIds: [], confirmation: 'Observe', invalidation: 'Reassess', limitations: ['Never calibrated'], recommendations: ['Bearer syntheticLongCredentialPlaceholder'] }
    const parsed = researchFeedbackDraftSchema.safeParse(f)
    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed)).not.toContain('syntheticLongCredentialPlaceholder')
  })
})
