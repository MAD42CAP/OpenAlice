import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataPath } from '../../core/paths.js'
import { buildMarketIntelligence } from './intelligence-market.js'
import type { IntelligenceProvenance } from './intelligence-types.js'
import { createResearchService, type ResearchService } from './research-service.js'
import { createInvestmentService } from './investment-service.js'
import { INVESTMENT_ANALYSIS_VERSION } from './investment-types.js'
import type { InvestmentDraft, MarketIntelligence, InvestmentReport } from './investment-types.js'
import type { ResearchDraft, ResearchReport, ResearchSnapshot, ResearchSource } from './research-types.js'
import type { MarketMonitorService } from './service.js'
import type { MarketMonitorSnapshot } from './types.js'
import type { ResearchLoopContext } from './research-loop-types.js'

export interface IntelligenceJob {
  state: 'idle' | 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'blocked'
  message: string; updatedAt: string | null; runId: string | null
}
export interface IntelligenceRunner { run(): Promise<IntelligenceJob>; status(): Promise<IntelligenceJob> }
interface FrozenInput {
  analysisVersion?: typeof INVESTMENT_ANALYSIS_VERSION
  id: string; hash: string; capturedAt: string; materialKey: string; provenance: IntelligenceProvenance
  needsAnalysis: string[]; market: MarketIntelligence; reports: ResearchReport[]; sources: ResearchSource[]
  research: ResearchSnapshot[]; priorInvestment: ReturnType<typeof compactInvestment>
  researchFeedback?: ResearchLoopContext
}
const compactInvestment = (report: InvestmentReport) => ({
  latest: report.latest ? { id: report.latest.id, summary: report.latest.summary, analysisTime: report.latest.analysisTime, changes: report.latest.changes, directions: report.latest.outlooks.map(o => ({ horizon: o.horizon, direction: o.direction, conclusion: o.conclusion })) } : null,
  theses: report.theses.slice(-40).map(t => ({ key: t.key, title: t.title, status: t.status, createdAt: t.createdAt, expiresAt: t.expiresAt, supportConditions: t.supportConditions, invalidationConditions: t.invalidationConditions, resolutionConditions: t.resolutionConditions })),
})
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const digest = (v: FrozenInput) => hash({ ...v, hash: '' })
const safeError = (error: unknown) => error instanceof Error && /^(?:Glassnode|Research|研究|缺少|市场|请先|当前)/.test(error.message) ? error.message.slice(0, 240) : '研究任务暂不可用；已保存的行情和研究记录仍可查看。'

export function createIntelligenceService(options: {
  monitor: Pick<MarketMonitorService, 'settings' | 'snapshots'>; research?: ResearchService
  investment?: ReturnType<typeof createInvestmentService>; root?: string; now?: () => Date
  feedback?: () => Promise<ResearchLoopContext>
}) {
  const research = options.research ?? createResearchService(), investment = options.investment ?? createInvestmentService()
  const root = options.root ?? dataPath('market-monitor', 'intelligence-v1'), now = options.now ?? (() => new Date())
  let runner: IntelligenceRunner | null = null
  let local: IntelligenceJob = { state: 'idle', message: '等待链上研究和市场资料。', updatedAt: null, runId: null }
  let forceNext = false
  let requestedAt = 0
  let requestedKey: string | null = null, request: Promise<unknown> | null = null
  const latestMarket = async () => {
    const settings = await options.monitor.settings()
    const row = (await options.monitor.snapshots('BTC', 1, settings.strategyId)).at(-1)
    return row ? buildMarketIntelligence(row, now()) : null
  }
  const materialKey = async (market: MarketIntelligence, frozenFeedbackHash?: string | null) => hash({
    analysisVersion: INVESTMENT_ANALYSIS_VERSION,
    daily: market.marketDataAsOf, price: market.price,
    horizons: market.horizons.map(h => ({ horizon: h.horizon, direction: h.direction, structure: h.structure, supportLevels: h.supportLevels, resistanceLevels: h.resistanceLevels })), quality: market.dataQuality,
    reports: (await research.reports()).map(r => r.contentHash),
    thesisStates: (await investment.report()).theses.map(t => [t.key, t.status]),
    feedbackHash: frozenFeedbackHash !== undefined ? frozenFeedbackHash : (await options.feedback?.())?.hash ?? null,
  })
  const fail = (error: unknown) => { local = { state: 'failed', message: safeError(error), updatedAt: now().toISOString(), runId: null } }
  const job = async () => {
    if (!runner) return local
    const state = await runner.status()
    if (['failed', 'blocked'].includes(local.state) && !['running', 'queued'].includes(state.state) && !(state.runId && Date.parse(state.updatedAt ?? '') >= Date.parse(local.updatedAt ?? ''))) return local
    if (state.state === 'success' && state.runId) {
      const r = await research.snapshots()
      let published = false
      try { const receipt = JSON.parse(await readFile(join(root, `published-${hash(state.runId)}.json`), 'utf8')); published = receipt.runId === state.runId && typeof receipt.snapshotId === 'string' } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      if (!published) return { ...state, state: r.some(s => s.provenance.runId === state.runId) ? 'partial' as const : 'failed' as const, message: '任务已结束，但综合研判尚未发布；可查看已有结果或手动重试。' }
    }
    return state
  }
  const report = async () => {
    const [market, reports, snapshots, latest, status, investments, currentJob] = await Promise.all([latestMarket(), research.reports(), research.snapshots(), research.latest(), research.status(), investment.report(), job()])
    return { asset: 'BTC' as const, generatedAt: now().toISOString(), market, research: { reports, snapshots, latest, status }, investment: investments, job: currentJob }
  }
  let dispatch: Promise<void> | null = null
  const runInternal = async (force = false) => {
    const market = await latestMarket(), reports = await research.reports()
    if (!market || !reports.length) {
      local = { state: 'blocked', message: !market ? '请先完成一次 BTC 行情扫描。' : '请先导入或发现一篇公开链上周报。', updatedAt: now().toISOString(), runId: null }
      return
    }
    const key = await materialKey(market)
    if (requestedKey === null) {
      try { const saved = JSON.parse(await readFile(join(root, 'request-state.json'), 'utf8')); requestedKey = saved.materialKey as string; requestedAt = Date.parse(saved.requestedAt) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    if (!force && requestedKey === key && now().getTime() - requestedAt < 86_400_000) return
    if (!runner) { local = { state: 'blocked', message: '当前原生 AI 工作区尚未就绪。', updatedAt: now().toISOString(), runId: null }; return }
    const active = await runner.status()
    if (active.state === 'running' || active.state === 'queued') { local = active; return }
    local = { state: 'queued', message: '已提交原生 AI 研究任务。', updatedAt: now().toISOString(), runId: null }
    try {
      await mkdir(root, { recursive: true, mode: 0o700 })
      await writeFile(join(root, 'request-state.json'), JSON.stringify({ materialKey: key, requestedAt: now().toISOString() }), { mode: 0o600 })
      forceNext = force; requestedKey = key; requestedAt = now().getTime(); local = await runner.run()
    } catch (error) { fail(error) }
  }
  const run = (force = false): Promise<void> => {
    if (dispatch) return dispatch
    dispatch = runInternal(force).finally(() => { dispatch = null })
    return dispatch
  }
  const background = (action: () => Promise<unknown>) => {
    if (request) return request
    request = action().catch(fail).finally(() => { request = null })
    return request
  }
  const readInput = async (id: string, provenance: IntelligenceProvenance): Promise<FrozenInput> => {
    if (!/^input-[a-f0-9]{64}$/.test(id)) throw new Error('Research input identity is invalid.')
    const row = JSON.parse(await readFile(join(root, `${id}.json`), 'utf8')) as FrozenInput
    if (row.id !== id || digest(row) !== row.hash || row.provenance.runId !== provenance.runId || row.provenance.workspaceId !== provenance.workspaceId || row.provenance.issueId !== provenance.issueId || Date.parse(row.capturedAt) > now().getTime()) throw new Error('Research input provenance or integrity check failed.')
    return row
  }
  return {
    research, investment, report,
    setRunner(value: IntelligenceRunner) { runner = value },
    async discover(force = false) { await research.discover(force); await run(); return report() },
    async importSource(input: { url: string; title?: string; text?: string; publishedAt?: string | null }) {
      if (input.text !== undefined) await research.importText({ url: input.url, title: input.title ?? '', text: input.text, publishedAt: input.publishedAt })
      else await research.importUrl(input.url)
      await run(); return report()
    },
    async run(force = true) { await run(force); return report() },
    afterScan(snapshot: MarketMonitorSnapshot) {
      if (snapshot.asset !== 'BTC') return Promise.resolve()
      return investment.revalidate(buildMarketIntelligence(snapshot, now())).then(() => {
        // Supplemental work must not hold the scan receipt or scheduler alive.
        void background(async () => { await research.discover(); await run() })
      }).catch(fail)
    },
    startup() { void background(async () => { await research.discover(); await run() }) },
    async nativeInput(provenance: IntelligenceProvenance) {
      const id = `input-${hash([provenance.workspaceId, provenance.runId])}`
      try { return await readInput(id, provenance) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await research.discover()
      const market = await latestMarket()
      if (!market) throw new Error('市场资料缺失，请先扫描 BTC。')
      const [reports, allResearch, investmentReport] = await Promise.all([research.reports(), research.snapshots(), investment.report()])
      const ordered = reports.filter(r => Date.parse(r.retrievedAt) <= now().getTime()).sort((a, b) => (a.publishedAt ?? a.retrievedAt).localeCompare(b.publishedAt ?? b.retrievedAt))
      const targets = ordered.slice(-2)
      const sources = (await Promise.all(targets.map(r => research.source(r.id)))).filter((s): s is ResearchSource => s !== null)
      const capturedAt = now().toISOString()
      const existing = targets.flatMap(report => allResearch.filter(s => s.reportId === report.id && s.analysisTime <= capturedAt && s.evidence.every(e => e.retrievedAt <= capturedAt && (!e.publishedAt || e.publishedAt <= capturedAt))).sort((a, b) => a.analysisTime.localeCompare(b.analysisTime)).slice(-1))
      const priorInvestment = compactInvestment(investmentReport)
      const needsAnalysis = targets.filter(r => !existing.some(s => s.reportId === r.id) || forceNext && r.id === targets.at(-1)?.id).map(r => r.id)
      forceNext = false
      const researchFeedback = await options.feedback?.()
      const input: FrozenInput = { analysisVersion: INVESTMENT_ANALYSIS_VERSION, needsAnalysis, id, hash: '', capturedAt: now().toISOString(), materialKey: await materialKey(market, researchFeedback?.hash ?? null), provenance: { ...provenance }, market, reports: targets, sources, research: existing, priorInvestment,
        ...(researchFeedback ? { researchFeedback } : {}) }
      input.hash = digest(input)
      await mkdir(root, { recursive: true, mode: 0o700 })
      try { await writeFile(join(root, `${id}.json`), JSON.stringify(input), { flag: 'wx', mode: 0o600 }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return readInput(id, provenance); throw error }
      return input
    },
    async publishResearch(id: string, reportId: string, draft: ResearchDraft, provenance: IntelligenceProvenance) {
      const input = await readInput(id, provenance)
      if (!input.reports.some(r => r.id === reportId)) throw new Error('Research report is outside the frozen native input.')
      const existing = (await research.snapshots()).find(s => s.reportId === reportId && s.provenance.runId === provenance.runId)
      if (existing) return existing
      if (!input.needsAnalysis.includes(reportId)) throw new Error('Research analysis already exists in this frozen input; reuse it or request reanalysis.')
      const source = input.sources.find(s => s.reportId === reportId), report = input.reports.find(r => r.id === reportId)!
      if (!source || source.contentHash !== report.contentHash) throw new Error('Research frozen source hash does not match.')
      const sameRun = (await research.snapshots()).filter(s => s.provenance.runId === provenance.runId && input.reports.some(r => r.id === s.reportId))
      return research.publish(reportId, draft, provenance, { allowedPreviousSnapshotIds: [...input.research, ...sameRun].map(s => s.id) })
    },
    async publishSynthesis(id: string, researchSnapshotId: string, draft: InvestmentDraft, provenance: IntelligenceProvenance) {
      const input = await readInput(id, provenance)
      const latestReport = input.reports.at(-1)
      const selected = (await research.snapshots()).find(s => s.id === researchSnapshotId && s.reportId === latestReport?.id && (s.provenance.runId === provenance.runId || input.research.some(r => r.id === s.id)))
      if (!selected) throw new Error('Research snapshot must be the latest report analysis bound to this input/run.')
      const result = await investment.publish({ market: input.market, research: selected, ...(input.researchFeedback ? { researchFeedback: input.researchFeedback } : {}) }, draft, provenance)
      // A contributor may finish while this native run is active. Only the
      // frozen material was consumed; newer feedback must still trigger work.
      requestedKey = input.materialKey
      requestedAt = now().getTime()
      await writeFile(join(root, 'request-state.json'), JSON.stringify({ materialKey: requestedKey, requestedAt: now().toISOString() }), { mode: 0o600 })
      const receipt = { runId: provenance.runId, inputId: input.id, snapshotId: result.snapshot.id, publishedAt: now().toISOString() }
      try { await writeFile(join(root, `published-${hash(provenance.runId)}.json`), JSON.stringify(receipt), { flag: 'wx', mode: 0o600 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      return result
    },
  }
}
export type IntelligenceService = ReturnType<typeof createIntelligenceService>
