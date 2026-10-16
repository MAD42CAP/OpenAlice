import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createIntelligenceService, type IntelligenceRunner } from './intelligence-service.js'
import type { ResearchService } from './research-service.js'
import type { MarketMonitorService } from './service.js'
import type { createInvestmentService } from './investment-service.js'
import type { MarketIntelligence } from './investment-types.js'
import type { MarketMonitorAsset, MarketMonitorSnapshot } from './types.js'
import type { ResearchSnapshot } from './research-types.js'
import { EQUITY_INVESTMENT_ANALYSIS_VERSION, INVESTMENT_ANALYSIS_VERSION } from './investment-types.js'
import { RESEARCH_LOOP_PROTOCOL, researchLoopProtocol, type ResearchLoopContext } from './research-loop-types.js'
vi.mock('./intelligence-market.js', () => ({ buildMarketIntelligence: (snapshot: { id: string; asset: MarketMonitorAsset; chart: { price: number }; companyEvidence?: unknown[]; dataQuality?: string }, at: Date) => ({ schemaVersion: 1, asset: snapshot.asset, snapshotId: snapshot.id, evidence: snapshot.companyEvidence ?? [], retrievedAt: at.toISOString(), analysisTime: at.toISOString(), price: snapshot.chart.price, horizons: [{ horizon: 'short', direction: 'neutral', structure: 'range', supportLevels: [90], resistanceLevels: [110] }], marketDataAsOf: '2026-10-13T00:00:00Z', hourlyDataAsOf: '2026-10-14T11:00:00Z', dataQuality: snapshot.dataQuality ?? 'partial' }) }))
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const provenance = { workspaceId: 'workspace', issueId: 'research', runId: 'run-1', agent: 'codex' }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'intelligence-')); roots.push(root)
  let snapshot = { id: 'market-1', asset: 'BTC', chart: { price: 100 } } as unknown as MarketMonitorSnapshot
  const report = { id: 'gn-report', retrievedAt: '2026-10-14T10:00:00Z', publishedAt: '2026-10-14T09:00:00Z', contentHash: 'source-hash' }
  const researchRows: ResearchSnapshot[] = []
  const research = { reports: vi.fn(async () => [report]), snapshots: vi.fn(async () => researchRows), latest: vi.fn(async () => researchRows.at(-1) ?? null), status: vi.fn(async () => ({})), discover: vi.fn(async () => ({})), source: vi.fn(async () => ({ reportId: report.id, contentHash: report.contentHash, paragraphs: [] })), publish: vi.fn(async (_id, draft, p) => { const row = { ...draft, id: `research-${researchRows.length}`, reportId: report.id, provenance: p } as ResearchSnapshot; researchRows.push(row); return row }) } as unknown as ResearchService
  const investment = { report: vi.fn(async () => ({ history: [], latest: null, theses: [] })), revalidate: vi.fn(async () => []), publish: vi.fn(async () => ({ stored: true, snapshot: { id: 'published' } })) } as unknown as ReturnType<typeof createInvestmentService>
  const monitor = { settings: vi.fn(async () => ({ strategyId: 'rules' })), snapshots: vi.fn(async () => [snapshot]) } as unknown as MarketMonitorService
  const opts = { root, research, investment, monitor, now: () => new Date('2026-10-14T12:00:00Z') }
  const service = createIntelligenceService(opts)
  return { root, opts, service, research, investment, researchRows, report, changeSnapshot: (id: string, price = 100) => { snapshot = { ...snapshot, id, chart: { price } } as unknown as MarketMonitorSnapshot } }
}
const runner = (): IntelligenceRunner => ({ run: vi.fn(async () => ({ state: 'running' as const, message: 'running', updatedAt: null, runId: 'run-1' })), status: vi.fn(async () => ({ state: 'idle' as const, message: '', updatedAt: null, runId: null })) })
describe('three-layer native evidence orchestration', () => {
  it('freezes feedback for synthesis and leaves a concurrently arriving card pending for a later scan', async () => {
    const f = await fixture(), r = runner()
    let feedback: ResearchLoopContext = { protocol: RESEARCH_LOOP_PROTOCOL, hash: 'a'.repeat(64), asOf: '2026-10-14T11:59:00Z', records: [], jev: null, evidence: [] }
    const service = createIntelligenceService({ ...f.opts, feedback: async () => structuredClone(feedback) }); service.setRunner(r)
    const frozen = await service.nativeInput(provenance)
    const published = await service.publishResearch(frozen.id, f.report.id, {} as never, provenance)
    feedback = { ...feedback, hash: 'b'.repeat(64) }
    await service.publishSynthesis(frozen.id, published.id, {} as never, provenance)
    expect(f.investment.publish).toHaveBeenCalledWith(expect.objectContaining({ researchFeedback: expect.objectContaining({ hash: 'a'.repeat(64) }) }), {}, provenance)
    const state = JSON.parse(await readFile(join(f.root, 'request-state.json'), 'utf8'))
    expect(state.materialKey).toBe(frozen.materialKey)
    expect((await service.nativeInput(provenance)).researchFeedback?.hash).toBe('a'.repeat(64))
    await service.run(false)
    expect(r.run).toHaveBeenCalledOnce()
  })
  it('freezes inputs per authenticated run, rejects cross-run reuse and tampering', async () => {
    const f = await fixture(), first = await f.service.nativeInput(provenance)
    f.changeSnapshot('market-2', 200)
    expect((await f.service.nativeInput(provenance)).market.price).toBe(100)
    await expect(f.service.publishResearch(first.id, f.report.id, {} as never, { ...provenance, runId: 'other' })).rejects.toThrow('provenance')
    await expect(f.service.publishResearch(first.id, 'unfrozen-report', {} as never, provenance)).rejects.toThrow('outside')
    const file = join(f.root, `${first.id}.json`), changed = JSON.parse(await readFile(file, 'utf8')); changed.market.price = 999
    await writeFile(file, JSON.stringify(changed))
    await expect(f.service.nativeInput(provenance)).rejects.toThrow('integrity')
  })
  it('binds synthesis to the latest report analysis from this input or native run', async () => {
    const f = await fixture(), frozen = await f.service.nativeInput(provenance)
    f.researchRows.push({ id: 'other-run-analysis', reportId: f.report.id, provenance: { ...provenance, runId: 'other' } } as ResearchSnapshot)
    await expect(f.service.publishSynthesis(frozen.id, 'other-run-analysis', {} as never, provenance)).rejects.toThrow('bound')
    const r = await f.service.publishResearch(frozen.id, f.report.id, {} as never, provenance)
    await f.service.publishSynthesis(frozen.id, r.id, {} as never, provenance)
    expect(f.investment.publish).toHaveBeenCalledWith(expect.objectContaining({ market: expect.objectContaining({ price: 100 }), research: r }), {}, provenance)
  })
  it('deduplicates materially identical scans across restarts, serializes dispatch and permits forced reanalysis', async () => {
    const f = await fixture(), r = runner(); f.service.setRunner(r)
    await Promise.all([f.service.run(false), f.service.run(false)])
    expect(r.run).toHaveBeenCalledTimes(1)
    const next = createIntelligenceService(f.opts); next.setRunner(r)
    f.changeSnapshot('new-id-same-market')
    await next.run(false); expect(r.run).toHaveBeenCalledTimes(1)
    await next.run(true); expect(r.run).toHaveBeenCalledTimes(2)
    const input = await next.nativeInput(provenance)
    expect(input.needsAnalysis).toContain(f.report.id)
  })
  it('invalidates a persisted v1 material cache on the first v2 analysis without rewriting old input archives', async () => {
    const f = await fixture(), r = runner()
    const frozen = await f.service.nativeInput(provenance)
    expect(frozen.analysisVersion).toBe(INVESTMENT_ANALYSIS_VERSION)
    const legacy = { ...frozen }
    delete legacy.analysisVersion
    legacy.hash = createHash('sha256').update(JSON.stringify({ ...legacy, hash: '' })).digest('hex')
    const file = join(f.root, `${legacy.id}.json`), bytes = JSON.stringify(legacy)
    await writeFile(file, bytes)
    expect((await f.service.nativeInput(provenance)).hash).toBe(legacy.hash)
    expect(await readFile(file, 'utf8')).toBe(bytes)
    const market = frozen.market
    const oldKey = createHash('sha256').update(JSON.stringify({ daily: market.marketDataAsOf, price: market.price, horizons: market.horizons.map(h => ({ horizon: h.horizon, direction: h.direction, structure: h.structure, supportLevels: h.supportLevels, resistanceLevels: h.resistanceLevels })), quality: market.dataQuality, reports: [f.report.contentHash], thesisStates: [] })).digest('hex')
    await writeFile(join(f.root, 'request-state.json'), JSON.stringify({ materialKey: oldKey, requestedAt: '2026-10-14T11:59:00Z' }))
    const restarted = createIntelligenceService(f.opts); restarted.setRunner(r)
    await restarted.run(false)
    expect(r.run).toHaveBeenCalledTimes(1)
    expect(await readFile(file, 'utf8')).toBe(bytes)
  })
  it('rechecks objective conditions on successful manual scans and ignores other assets', async () => {
    const f = await fixture()
    await f.service.afterScan({ asset: 'TSLA' } as MarketMonitorSnapshot)
    expect(f.investment.revalidate).not.toHaveBeenCalled()
    await f.service.afterScan({ id: 'manual', asset: 'BTC', chart: { price: 100 } } as unknown as MarketMonitorSnapshot)
    expect(f.investment.revalidate).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 'manual' }) as MarketIntelligence)
  })
  it('shows the real native task after an earlier local missing-input blocker', async () => {
    const f = await fixture(), r = runner(); f.service.setRunner(r)
    vi.mocked(f.research.reports).mockResolvedValueOnce([])
    expect((await f.service.run(false)).job.state).toBe('blocked')
    vi.mocked(r.status).mockResolvedValue({ state: 'running', message: 'native resumed', updatedAt: '2026-10-14T12:00:00Z', runId: 'resumed' })
    expect((await f.service.report()).job).toMatchObject({ state: 'running', runId: 'resumed' })
  })
  it('records successful cached publication for the current run even when the saved snapshot belongs to an older run', async () => {
    const f = await fixture(), r = runner(); f.service.setRunner(r)
    const frozen = await f.service.nativeInput(provenance), research = await f.service.publishResearch(frozen.id, f.report.id, {} as never, provenance)
    vi.mocked(f.investment.publish).mockResolvedValue({ stored: false, snapshot: { id: 'existing-publication', provenance: { runId: 'old-run' } } } as never)
    await f.service.publishSynthesis(frozen.id, research.id, {} as never, provenance)
    vi.mocked(r.status).mockResolvedValue({ state: 'success', message: 'done', updatedAt: '2026-10-14T12:00:00Z', runId: provenance.runId })
    expect((await f.service.report()).job.state).toBe('success')
  })
  it('reports an ended native run with no published synthesis as failure, rather than completion', async () => {
    const f = await fixture(), r = runner(); vi.mocked(r.status).mockResolvedValue({ state: 'success', message: '', updatedAt: null, runId: 'ended' }); f.service.setRunner(r)
    expect((await f.service.report()).job.state).toBe('failed')
  })
})


async function equityFixture(asset: 'TSLA' | 'MSTR') {
  const f = await fixture()
  let snapshot = { id: `${asset}-market-1`, asset, chart: { price: asset === 'TSLA' ? 400 : 300 } } as unknown as MarketMonitorSnapshot
  const monitor = { settings: vi.fn(async () => ({ strategyId: 'rules' })), snapshots: vi.fn(async () => [snapshot]) } as unknown as MarketMonitorService
  const feedback: ResearchLoopContext = { protocol: researchLoopProtocol(asset), asset, hash: 'a'.repeat(64), asOf: '2026-10-14T11:59:00Z', records: [], jev: null, evidence: [] }
  const opts = { ...f.opts, asset, root: join(f.root, asset), monitor, feedback: vi.fn(async () => structuredClone(feedback)) }
  const service = createIntelligenceService(opts)
  const p = { ...provenance, issueId: `mad42lab-${asset.toLowerCase()}-investment-intelligence` }
  return { ...f, opts, service, monitor, feedback, p, changeSnapshot: (id: string, companyEvidence?: unknown[], dataQuality?: string) => { snapshot = { ...snapshot, id, companyEvidence, dataQuality } as unknown as MarketMonitorSnapshot } }
}

describe('equity native synthesis asset isolation', () => {
  it.each(['TSLA', 'MSTR'] as const)('freezes %s evidence and publishes without importing or fabricating a Glassnode report', async asset => {
    const f = await equityFixture(asset), r = runner(); f.service.setRunner(r)
    const input = await f.service.nativeInput(f.p)
    expect(input).toMatchObject({ analysisVersion: EQUITY_INVESTMENT_ANALYSIS_VERSION, market: { asset }, reports: [], sources: [], research: [], needsAnalysis: [], researchFeedback: { asset, protocol: 'equity-research-loop-v1' } })
    for (const fn of [f.research.discover, f.research.reports, f.research.snapshots, f.research.latest, f.research.source]) expect(fn).not.toHaveBeenCalled()
    await f.service.publishSynthesis(input.id, undefined, {} as never, f.p)
    expect(f.investment.publish).toHaveBeenCalledWith(expect.objectContaining({ market: expect.objectContaining({ asset }), research: null, researchFeedback: expect.objectContaining({ asset }) }), {}, f.p)
    vi.mocked(r.status).mockResolvedValue({ state: 'success', runId: f.p.runId, updatedAt: '2026-10-14T12:00:00Z', message: '' })
    expect((await f.service.report()).job.state).toBe('success')
    expect(await f.service.report()).toMatchObject({ asset, research: { reports: [], snapshots: [], latest: null } })
    expect(f.research.discover).not.toHaveBeenCalled()
  })

  it.each(['TSLA', 'MSTR'] as const)('rejects %s cross-asset/role provenance and foreign report attachment', async asset => {
    const f = await equityFixture(asset), input = await f.service.nativeInput(f.p)
    for (const issueId of ['mad42lab-investment-intelligence', `mad42lab-${asset.toLowerCase()}-prediction-research`, `mad42lab-${asset === 'TSLA' ? 'mstr' : 'tsla'}-investment-intelligence`]) {
      await expect(f.service.nativeInput({ ...f.p, issueId })).rejects.toThrow('Issue')
      await expect(f.service.publishSynthesis(input.id, undefined, {} as never, { ...f.p, issueId })).rejects.toThrow('provenance')
    }
    await expect(f.service.publishSynthesis(input.id, 'btc-report-analysis', {} as never, f.p)).rejects.toThrow('BTC research report')
    await expect(f.service.publishResearch(input.id, 'gn-report', {} as never, f.p)).rejects.toThrow('BTC only')
    await expect(f.service.discover()).rejects.toThrow('BTC only')
    await expect(f.service.importSource({ url: 'https://research.glassnode.com/' })).rejects.toThrow('BTC only')
    expect(f.investment.publish).not.toHaveBeenCalled()
    expect(f.research.discover).not.toHaveBeenCalled()
  })

  it.each(['TSLA', 'MSTR'] as const)('dispatches only for fresh %s evidence and never revalidates another asset', async asset => {
    const f = await equityFixture(asset), r = runner(); f.service.setRunner(r)
    f.changeSnapshot('unusable', [], 'unavailable')
    expect((await f.service.run()).job.state).toBe('blocked')
    expect(r.run).not.toHaveBeenCalled()
    f.changeSnapshot('fresh')
    await f.service.run(false)
    expect(r.run).toHaveBeenCalledOnce()
    await f.service.afterScan({ asset: asset === 'TSLA' ? 'MSTR' : 'TSLA' } as MarketMonitorSnapshot)
    await f.service.afterScan({ asset: 'BTC' } as MarketMonitorSnapshot)
    expect(f.investment.revalidate).not.toHaveBeenCalled()
    await f.service.afterScan({ id: 'own-asset', asset, chart: { price: 400 } } as unknown as MarketMonitorSnapshot)
    expect(f.investment.revalidate).toHaveBeenCalledWith(expect.objectContaining({ asset, snapshotId: 'own-asset' }))
    expect(f.research.discover).not.toHaveBeenCalled()
  })

  it('keeps both stock input identities distinct even when a native run/workspace ID is reused', async () => {
    const tsla = await equityFixture('TSLA'), mstr = await equityFixture('MSTR')
    const a = await tsla.service.nativeInput(tsla.p), b = await mstr.service.nativeInput(mstr.p)
    expect(a.id).not.toBe(b.id)
    await expect(tsla.service.publishSynthesis(b.id, undefined, {} as never, tsla.p)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(mstr.service.publishSynthesis(a.id, undefined, {} as never, mstr.p)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(tsla.investment.publish).not.toHaveBeenCalled(); expect(mstr.investment.publish).not.toHaveBeenCalled()
  })

  it('reuses an unchanged equity evidence cache across rescans, but refreshes changed facts or feedback', async () => {
    const f = await equityFixture('TSLA'), r = runner(); f.service.setRunner(r)
    const reference = { id: 'snapshot-one:market-cap', asset: 'TSLA', metric: 'equity.market-cap', value: 1_000_000, unit: 'USD', sourceName: 'readonly-reference', sourceUrl: null, dataAsOf: '2026-10-14T11:00:00Z', retrievedAt: '2026-10-14T11:05:00Z', publishedAt: null, quality: 'available', reportId: null, kind: 'observation' }
    f.changeSnapshot('snapshot-one', [reference])
    await f.service.run(false); expect(r.run).toHaveBeenCalledTimes(1)
    f.changeSnapshot('snapshot-two', [{ ...reference, id: 'snapshot-two:market-cap', retrievedAt: '2026-10-14T11:30:00Z' }])
    const restarted = createIntelligenceService(f.opts); restarted.setRunner(r)
    await restarted.run(false); expect(r.run).toHaveBeenCalledTimes(1)
    f.changeSnapshot('changed-fact', [{ ...reference, value: 2_000_000 }])
    await restarted.run(false); expect(r.run).toHaveBeenCalledTimes(2)
    f.feedback.hash = 'b'.repeat(64)
    await restarted.run(false); expect(r.run).toHaveBeenCalledTimes(3)
  })
})


describe('stock native synthesis failure recovery', () => {
  it.each(['TSLA', 'MSTR'] as const)('automatically retries unchanged %s evidence after a failed or blocked native run', async asset => {
    const f = await equityFixture(asset), r = runner(); f.service.setRunner(r)
    await f.service.run(false)
    expect(r.run).toHaveBeenCalledTimes(1)
    vi.mocked(r.status).mockResolvedValue({ state: 'failed', message: 'native run failed', updatedAt: '2026-10-14T12:00:00Z', runId: 'failed-native' })
    await f.service.run(false)
    expect(r.run).toHaveBeenCalledTimes(2)
    vi.mocked(r.status).mockResolvedValue({ state: 'blocked', message: 'workspace was occupied', updatedAt: '2026-10-14T12:00:00Z', runId: 'busy-native' })
    const restarted = createIntelligenceService(f.opts); restarted.setRunner(r)
    await restarted.run(false)
    expect(r.run).toHaveBeenCalledTimes(3)
  })

  it('retries an ended native stock task that never published a synthesis receipt', async () => {
    const f = await equityFixture('MSTR'), r = runner(); f.service.setRunner(r)
    await f.service.run(false)
    vi.mocked(r.status).mockResolvedValue({ state: 'success', message: 'ended without publication', updatedAt: '2026-10-14T12:00:00Z', runId: 'ended-without-publication' })
    expect((await f.service.report()).job.state).toBe('failed')
    await f.service.run(false)
    expect(r.run).toHaveBeenCalledTimes(2)
  })

  it('does not duplicate an active stock run or an unchanged successfully published synthesis', async () => {
    const f = await equityFixture('TSLA'), r = runner(); f.service.setRunner(r)
    await f.service.run(false)
    vi.mocked(r.status).mockResolvedValue({ state: 'running', message: 'active', updatedAt: '2026-10-14T12:00:00Z', runId: 'active' })
    await f.service.run(false)
    expect(r.run).toHaveBeenCalledTimes(1)
    const frozen = await f.service.nativeInput(f.p)
    await f.service.publishSynthesis(frozen.id, undefined, {} as never, f.p)
    vi.mocked(r.status).mockResolvedValue({ state: 'success', message: 'published', updatedAt: '2026-10-14T12:00:00Z', runId: f.p.runId })
    await f.service.run(false)
    expect(r.run).toHaveBeenCalledTimes(1)
  })

  it('preserves the shipped BTC cache behavior after an unchanged failed task', async () => {
    const f = await fixture(), r = runner(); f.service.setRunner(r)
    await f.service.run(false)
    vi.mocked(r.status).mockResolvedValue({ state: 'failed', message: 'existing BTC behavior', updatedAt: '2026-10-14T12:00:00Z', runId: 'failed' })
    await f.service.run(false)
    expect(r.run).toHaveBeenCalledTimes(1)
  })
})
