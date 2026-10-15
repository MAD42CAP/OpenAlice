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
import type { MarketMonitorSnapshot } from './types.js'
import type { ResearchSnapshot } from './research-types.js'
vi.mock('./intelligence-market.js', () => ({ buildMarketIntelligence: (snapshot: { id: string; chart: { price: number } }, at: Date) => ({ schemaVersion: 1, snapshotId: snapshot.id, analysisTime: at.toISOString(), price: snapshot.chart.price, horizons: [{ horizon: 'short', direction: 'neutral', structure: 'range', supportLevels: [90], resistanceLevels: [110] }], marketDataAsOf: '2026-10-13T00:00:00Z', hourlyDataAsOf: '2026-10-14T11:00:00Z', dataQuality: 'partial' }) }))
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
    expect(frozen.analysisVersion).toBe('investment-intelligence-v2')
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
