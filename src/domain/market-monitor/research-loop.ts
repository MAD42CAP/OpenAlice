import { z } from 'zod'
import { hashJevInput } from './typesafe-input.js'
import { evidenceAvailability } from './investment.js'
import { forwardRecordHash } from './forecast-validation-store.js'
import { guardedJevDecision } from './forecast-validation-input.js'
import { FORWARD_PROTOCOL } from './forecast-validation-types.js'
import { createResearchLoopStore, researchLoopInputHash, researchLoopRecordHash } from './research-loop-store.js'
import { researchLoopIssueIds, researchLoopProtocol, type ResearchContributor, type ResearchFeedbackDraft, type ResearchFeedbackRecord, type ResearchLoopContext, type ResearchLoopInput, type ResearchLoopJob, type ResearchLoopJev, type ResearchLoopReport, type ResearchLoopRunner, type ResearchRole } from './research-loop-types.js'
import type { EvidenceReference, IntelligenceProvenance } from './intelligence-types.js'
import type { MarketIntelligence } from './investment-types.js'
import type { ResearchSnapshot } from './research-types.js'
import type { ForwardReport } from './forecast-validation-types.js'
import type { MarketMonitorAsset } from './types.js'
import { assertFreshBars } from './bar-policy.js'
import { reviewSessionDate } from './review.js'

const DAY = 86_400_000
const ROLES = ['prediction', 'quant'] as const
const HORIZONS = ['short', 'medium', 'long'] as const
const text = z.string().trim().min(1).max(1800)
const ids = z.array(z.string().min(1).max(400)).max(24)
export const researchFeedbackDraftSchema = z.object({
  summary: text, horizon: z.enum(['short', 'medium', 'long', 'all']), conclusion: z.enum(['supports', 'opposes', 'inconclusive']),
  supportingEvidenceIds: ids, opposingEvidenceIds: ids, confirmation: text, invalidation: text,
  limitations: z.array(text).min(1).max(12), recommendations: z.array(text).max(12),
}).strict().superRefine((draft, ctx) => {
  if (draft.conclusion === 'supports' && !draft.supportingEvidenceIds.length || draft.conclusion === 'opposes' && !draft.opposingEvidenceIds.length) ctx.addIssue({ code: 'custom', message: '明确结论必须引用相应证据。' })
  if (new Set(draft.supportingEvidenceIds).size !== draft.supportingEvidenceIds.length || new Set(draft.opposingEvidenceIds).size !== draft.opposingEvidenceIds.length || draft.supportingEvidenceIds.some(id => draft.opposingEvidenceIds.includes(id))) ctx.addIssue({ code: 'custom', message: '支持和反向证据不能重复。' })
  if (/(?:-----BEGIN [^-]*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~-]{12,}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b(?:sk|ts|typesafe)[-_][A-Za-z0-9_-]{20,}\b)/i.test(JSON.stringify(draft))) ctx.addIssue({ code: 'custom', message: '研究成果包含不可保存的敏感内容。' })
})
type Source = { market: MarketIntelligence; research: ResearchSnapshot | null; forward: ForwardReport }
const stamp = (value: string | null | undefined) => value ? Date.parse(value) : NaN
const validTime = (value: string | null | undefined, at: Date) => Number.isFinite(stamp(value)) && stamp(value) <= at.getTime()
const provenanceSchema = z.object({ workspaceId: z.string().min(1).max(240), runId: z.string().min(1).max(240), issueId: z.string().min(1).max(240), agent: z.string().min(1).max(240), model: z.string().min(1).max(240).optional() }).strict()
const identity = (role: ResearchRole, p: IntelligenceProvenance, asset: MarketMonitorAsset) => `loop-input-${hashJevInput({ role, workspaceId: p.workspaceId, runId: p.runId, issueId: p.issueId, ...(asset === 'BTC' ? {} : { asset }) })}`
const sameProvenance = (a: IntelligenceProvenance, b: IntelligenceProvenance) => JSON.stringify(a) === JSON.stringify(b)
const feedbackId = (inputId: string) => `feedback-${hashJevInput(inputId)}`
const marketReady = (market: MarketIntelligence, at: Date, asset: MarketMonitorAsset = market.asset) => {
  if (market.asset !== asset || !validTime(market.retrievedAt, at) || !validTime(market.analysisTime, at) || !validTime(market.marketDataAsOf, at)
    || stamp(market.marketDataAsOf) > stamp(market.retrievedAt) || market.evidence.some(e => e.asset !== asset)) return false
  if (asset === 'BTC') { if (at.getTime() - stamp(market.marketDataAsOf) > 2 * DAY) return false }
  else { try { assertFreshBars(market.daily, asset, '1d', at) } catch { return false } }
  return market.evidence.some(e => e.asset === asset && e.metric === 'daily-close' && e.kind === 'observation' && evidenceAvailability(e, at) === 'available')
}
const provenanceValid = (role: ResearchRole, p: IntelligenceProvenance, asset: MarketMonitorAsset) => provenanceSchema.safeParse(p).success && p.issueId === researchLoopIssueIds(asset)[role]

function currentJev(source: Source, at: Date): { jev: ResearchLoopJev | null; evidence: EvidenceReference[] } {
  const asset = source.market.asset
  const { publication: pub, candidate } = source.forward.latest ?? {}
  if (!pub || !candidate || source.forward.asset !== asset || source.forward.protocol !== FORWARD_PROTOCOL || pub.protocol !== FORWARD_PROTOCOL || pub.asset !== asset
    || pub.recordHash !== forwardRecordHash(pub) || pub.inputHash !== hashJevInput(pub.input) || candidate.recordHash !== forwardRecordHash(candidate)
    || candidate.protocol !== FORWARD_PROTOCOL || candidate.publicationId !== pub.id || candidate.inputHash !== pub.inputHash
    || !validTime(pub.issuedAt, at) || !validTime(candidate.requestedAt, at) || !validTime(candidate.issuedAt, at)
    || stamp(pub.issuedAt) > stamp(candidate.requestedAt) || stamp(candidate.requestedAt) > stamp(candidate.issuedAt)
    || reviewSessionDate(asset, pub.issuedAt) !== reviewSessionDate(asset, at.toISOString())
    || reviewSessionDate(asset, candidate.issuedAt) !== reviewSessionDate(asset, at.toISOString())) return { jev: null, evidence: [] }
  const daily = pub.input.state.daily as { lastClosedAt?: string } | undefined
  if (!daily?.lastClosedAt || daily.lastClosedAt.slice(0, 10) !== source.market.marketDataAsOf?.slice(0, 10) || !marketReady(source.market, at, asset)) return { jev: null, evidence: [] }
  try {
    if (HORIZONS.some(h => JSON.stringify(guardedJevDecision(candidate.raw, h, pub.input.history[h])) !== JSON.stringify(candidate.decisions[h]))) return { jev: null, evidence: [] }
    const decisions = Object.fromEntries(HORIZONS.map(h => [h, { choice: candidate.decisions[h].choice, reasons: [...candidate.decisions[h].reasons] }])) as ResearchLoopJev['decisions']
    const jev: ResearchLoopJev = { publicationId: pub.id, candidateHash: candidate.recordHash, issuedAt: candidate.issuedAt, inputHash: pub.inputHash, snapshotId: pub.basis.snapshotId, decisions }
    const evidence = HORIZONS.map((h): EvidenceReference => ({ id: `jev:${pub.id}:${candidate.recordHash}:${h}`, asset, sourceName: 'Jev market-forward-v2 (unvalidated inference)', sourceUrl: null,
      metric: `research-feedback.jev.${h}`, value: decisions[h].choice ?? 'abstain', unit: null, dataAsOf: candidate.issuedAt, publishedAt: candidate.issuedAt, retrievedAt: candidate.issuedAt,
      quality: 'available', reportId: null, kind: 'inference', excerpt: JSON.stringify({ publicationId: pub.id, candidateHash: candidate.recordHash, effectiveChoice: decisions[h].choice, reasons: decisions[h].reasons, rawProbabilities: candidate.raw.answers[h]?.probabilities ?? null }) }))
    return { jev, evidence }
  } catch { return { jev: null, evidence: [] } }
}

function validateInput(input: ResearchLoopInput, at: Date, asset: MarketMonitorAsset) {
  if (input.hash !== researchLoopInputHash(input) || input.schemaVersion !== 1 || input.protocol !== researchLoopProtocol(asset) || !ROLES.includes(input.role)
    || !provenanceValid(input.role, input.provenance, asset) || input.id !== identity(input.role, input.provenance, asset) || !validTime(input.capturedAt, at)
    || stamp(input.expiresAt) !== stamp(input.capturedAt) + DAY || at.getTime() >= stamp(input.expiresAt) || !marketReady(input.market, new Date(input.capturedAt), asset) || input.forward.asset !== asset || (asset !== 'BTC' && input.research !== null) || input.evidence.some(e => e.asset !== asset)
    || new Set(input.evidence.map(e => e.id)).size !== input.evidence.length) throw new Error('研究输入无效、已过期或来源不匹配。')
  const expected = [...input.market.evidence, ...(input.research?.evidence ?? []), ...currentJev(input, new Date(input.capturedAt)).evidence]
  if (JSON.stringify(expected) !== JSON.stringify(input.evidence)) throw new Error('研究输入的证据与冻结来源不匹配。')
  if (input.research && (!validTime(input.research.analysisTime, new Date(input.capturedAt)) || input.research.publicationTime !== null && !validTime(input.research.publicationTime, new Date(input.capturedAt)))) throw new Error('研究来源尚未发布或尚未获取。')
}

function validateDraft(input: ResearchLoopInput, value: unknown, at: Date): ResearchFeedbackDraft {
  const draft = researchFeedbackDraftSchema.parse(value) as ResearchFeedbackDraft
  const byId = new Map(input.evidence.map(e => [e.id, e]))
  for (const id of [...draft.supportingEvidenceIds, ...draft.opposingEvidenceIds]) {
    const e = byId.get(id)
    if (!e || evidenceAvailability(e, at) !== 'available' || !validTime(e.retrievedAt, new Date(input.capturedAt)) || e.publishedAt !== null && !validTime(e.publishedAt, new Date(input.capturedAt))) throw new Error('引用必须来自冻结输入中当时可用的证据。')
  }
  return draft
}

export function createResearchLoop(options: {
  source: () => Promise<Source>; asset?: MarketMonitorAsset; root?: string; now?: () => Date; onPublished?: () => Promise<void>; synthesis?: () => Promise<ResearchLoopReport['synthesis']>
}) {
  const asset = options.asset ?? 'BTC', protocol = researchLoopProtocol(asset)
  const store = createResearchLoopStore(options.root, asset), now = options.now ?? (() => new Date())
  let runner: ResearchLoopRunner | null = null, pending: Promise<ResearchLoopReport> | null = null
  const dispatchErrors = new Map<ResearchRole, string>()
  const jobs = async () => Object.fromEntries(await Promise.all(ROLES.map(async role => {
    let job: ResearchLoopJob
    try { job = runner ? await runner.status(role) : { state: 'blocked', message: '原生研究工作区尚未就绪。', updatedAt: null, workspaceId: null, runId: null } }
    catch { job = { state: 'failed', message: '暂时无法读取原生研究任务状态。', updatedAt: null, workspaceId: null, runId: null } }
    if (dispatchErrors.has(role) && job.state !== 'running' && job.state !== 'queued') job = { ...job, state: 'failed', message: dispatchErrors.get(role)! }
    return [role, job]
  }))) as Record<ResearchRole, ResearchLoopJob>
  const authorize = async (role: ResearchRole, provenance: IntelligenceProvenance) => {
    if (!ROLES.includes(role) || !provenanceValid(role, provenance, asset) || !runner) throw new Error('只有指定研究 Issue 的运行可以发布。')
    const job = await runner.status(role)
    if (job.state !== 'running' || job.workspaceId !== provenance.workspaceId || job.runId !== provenance.runId) throw new Error('研究调用与当前运行身份不匹配。')
  }
  const history = async (at: Date) => {
    const archive = await store.list(), rows: ResearchFeedbackRecord[] = []
    let invalid = archive.invalid
    for (const row of archive.rows) {
      try {
        const input = await store.input(row.inputId)
        if (!input || row.id !== feedbackId(input.id) || !validTime(row.issuedAt, at) || row.validation !== 'unvalidated' || row.asset !== asset
          || row.role !== input.role || row.inputHash !== input.hash || row.expiresAt !== input.expiresAt || !sameProvenance(row.provenance, input.provenance)
          || JSON.stringify(row.basis) !== JSON.stringify({ snapshotId: input.market.snapshotId, marketDataAsOf: input.market.marketDataAsOf, capturedAt: input.capturedAt }) || stamp(row.issuedAt) < stamp(input.capturedAt)) throw new Error('identity')
        validateInput(input, new Date(row.issuedAt), asset)
        const parsed = validateDraft(input, Object.fromEntries(['summary', 'horizon', 'conclusion', 'supportingEvidenceIds', 'opposingEvidenceIds', 'confirmation', 'invalidation', 'limitations', 'recommendations'].map(key => [key, row[key as keyof ResearchFeedbackDraft]])), new Date(row.issuedAt))
        const evidence = input.evidence.filter(e => [...parsed.supportingEvidenceIds, ...parsed.opposingEvidenceIds].includes(e.id))
        if (JSON.stringify(evidence) !== JSON.stringify(row.evidence)) throw new Error('evidence')
        rows.push(row)
      } catch { invalid++ }
    }
    return { rows: rows.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.id.localeCompare(a.id)), invalid }
  }
  const read = async () => {
    // Source acquisition projects its own analysis time. Freeze only after it settles.
    const loaded = await options.source().catch(() => null), at = now(), archive = await history(at)
    const source = loaded && loaded.market.asset === asset && loaded.forward.asset === asset && (asset === 'BTC' || loaded.research === null) ? loaded : null
    const current = source && marketReady(source.market, at, asset) ? ROLES.flatMap(role => {
      const row = archive.rows.find(r => r.role === role)
      return row && stamp(row.expiresAt) > at.getTime() && row.basis.marketDataAsOf === source.market.marketDataAsOf
        && row.evidence.every(e => evidenceAvailability(e, at) === 'available') ? [row] : []
    }) : []
    const projected = source ? currentJev(source, at) : { jev: null, evidence: [] }
    const evidence: EvidenceReference[] = [...current.map((row): EvidenceReference => ({ id: `research-feedback:${row.id}`, asset, sourceName: `${row.role === 'quant' ? 'Auto Quant' : 'Auto Prediction'} (unvalidated inference)`, sourceUrl: null,
      metric: `research-feedback.${row.role}`, value: row.summary, unit: null, dataAsOf: row.issuedAt, publishedAt: row.issuedAt, retrievedAt: row.issuedAt, quality: 'available', reportId: null, kind: 'inference', excerpt: `Frozen input ${row.inputId}; conclusion ${row.conclusion}; horizon ${row.horizon}; unvalidated research context, never an independent price observation.` })), ...projected.evidence]
    const asOf = [...current.map(r => r.issuedAt), ...(projected.jev ? [projected.jev.issuedAt] : [])].sort().at(-1) ?? source?.market.retrievedAt ?? at.toISOString()
    const context: ResearchLoopContext = { protocol, ...(asset === 'BTC' ? {} : { asset }), hash: '', asOf, records: current, jev: projected.jev, evidence }
    context.hash = hashJevInput({ protocol: context.protocol, ...(asset === 'BTC' ? {} : { asset }), records: current.map(r => r.recordHash), jev: projected.jev })
    return { at, source, archive, context }
  }
  const report = async (): Promise<ResearchLoopReport> => {
    const { at, source, archive, context } = await read(), status = await jobs()
    const contributors: ResearchContributor[] = ROLES.map(role => {
      const latest = archive.rows.find(r => r.role === role), fresh = context.records.find(r => r.role === role), job = status[role]
      const artifactForJob = latest && latest.provenance.runId === job.runId && latest.provenance.workspaceId === job.workspaceId
      const state: ResearchContributor['state'] = !source ? 'blocked' : job.state === 'running' || job.state === 'queued' ? 'running'
        : job.state === 'failed' ? 'failed' : job.state === 'blocked' ? 'blocked'
          : job.state === 'success' && !artifactForJob ? 'failed' : fresh ? 'ready' : latest ? 'stale' : 'waiting'
      return { source: role, state, updatedAt: latest?.issuedAt ?? job.updatedAt, summary: !source ? '市场输入暂不可用，已保存研究保留为历史。' : state === 'ready' ? fresh!.summary : state === 'stale' ? '研究依据已过期，等待新一轮复核。' : job.state === 'success' && !artifactForJob ? '研究运行已结束，但没有发布可核验成果。' : job.message,
        recordId: latest?.id ?? null, workspaceId: job.workspaceId ?? latest?.provenance.workspaceId ?? null, runId: job.runId ?? latest?.provenance.runId ?? null }
    })
    const priorJev = source?.forward.latest?.candidate
    contributors.push({ source: 'jev', state: !source ? 'blocked' : context.jev ? 'ready' : priorJev ? 'stale' : 'waiting', updatedAt: context.jev?.issuedAt ?? priorJev?.issuedAt ?? null,
      summary: context.jev ? '已引用当前会话 Jev v2 推断；暂不判断保留为弃权，不计作独立证据。' : '等待当前会话、相同已收盘日线依据的 Jev v2 结果。', recordId: context.jev ? `${context.jev.publicationId}:${context.jev.candidateHash}` : null, workspaceId: null, runId: null })
    let synthesis: ResearchLoopReport['synthesis'] = null
    try { synthesis = await options.synthesis?.() ?? null } catch { /* A failed synthesis does not hide saved research. */ }
    return { protocol, asset, generatedAt: at.toISOString(), contributors, context, history: archive.rows.slice(0, 60), invalidRecords: archive.invalid, synthesis }
  }
  return {
    setRunner(value: ResearchLoopRunner) { runner = value },
    async nativeInput(role: ResearchRole, provenance: IntelligenceProvenance): Promise<ResearchLoopInput> {
      await authorize(role, provenance)
      const id = identity(role, provenance, asset), existing = await store.input(id)
      if (existing) { validateInput(existing, now(), asset); if (!sameProvenance(existing.provenance, provenance)) throw new Error('研究运行身份变化。'); return existing }
      const source = structuredClone(await options.source()), at = now()
      if (!marketReady(source.market, at, asset) || source.forward.asset !== asset || asset !== 'BTC' && source.research !== null) throw new Error(`请先取得可验证的 ${asset} 已收盘日线与同资产研究来源。`)
      if (source.research && (!validTime(source.research.analysisTime, at) || source.research.publicationTime !== null && !validTime(source.research.publicationTime, at))) source.research = null
      const archive = await history(at), projected = currentJev(source, at)
      const input: ResearchLoopInput = { schemaVersion: 1, protocol, id, hash: '', capturedAt: at.toISOString(), expiresAt: new Date(at.getTime() + DAY).toISOString(), role, provenance: structuredClone(provenance), ...source,
        previous: archive.rows.slice(0, 4), evidence: [...source.market.evidence, ...(source.research?.evidence ?? []), ...projected.evidence] }
      input.hash = researchLoopInputHash(input); validateInput(input, at, asset)
      try { return await store.saveInput(input) }
      catch (error) { const frozen = await store.input(id); if (frozen && sameProvenance(frozen.provenance, provenance)) { validateInput(frozen, at, asset); return frozen } throw error }
    },
    async publish(inputId: string, value: unknown, provenance: IntelligenceProvenance): Promise<ResearchFeedbackRecord> {
      const input = await store.input(inputId)
      if (!input) throw new Error('必须先冻结本次研究输入。')
      await authorize(input.role, provenance)
      const source = await options.source(), at = now(); validateInput(input, at, asset)
      if (!sameProvenance(input.provenance, provenance)) throw new Error('研究发布身份与冻结输入不同。')
      if (!marketReady(source.market, at, asset) || source.market.marketDataAsOf !== input.market.marketDataAsOf) throw new Error('已收盘日线依据已变化，请下一次运行重新研究。')
      const draft = validateDraft(input, value, at), id = feedbackId(input.id)
      const existing = await store.feedback(id)
      if (existing) {
        if (JSON.stringify(Object.fromEntries(Object.keys(draft).map(key => [key, existing[key as keyof ResearchFeedbackDraft]]))) !== JSON.stringify(draft)) throw new Error('该研究成果已经发布，不能覆盖。')
        return existing
      }
      const row: ResearchFeedbackRecord = { ...draft, schemaVersion: 1, protocol, id, asset, role: input.role, inputId, inputHash: input.hash, issuedAt: at.toISOString(), expiresAt: input.expiresAt,
        basis: { snapshotId: input.market.snapshotId, marketDataAsOf: input.market.marketDataAsOf, capturedAt: input.capturedAt }, provenance: structuredClone(provenance), validation: 'unvalidated',
        evidence: input.evidence.filter(e => [...draft.supportingEvidenceIds, ...draft.opposingEvidenceIds].includes(e.id)), recordHash: '' }
      row.recordHash = researchLoopRecordHash(row)
      const saved = await store.saveFeedback(row)
      try { await options.onPublished?.() } catch { /* Saved publications survive downstream native-runtime failures. */ }
      return saved
    },
    async context() { return (await read()).context },
    report,
    run(): Promise<ResearchLoopReport> {
      if (pending) return pending
      pending = (async () => {
        if (!runner) return report()
        try { await runner.ensure() }
        catch {
          for (const role of ROLES) dispatchErrors.set(role, '原生研究工作区暂时无法准备，请稍后重试。')
          return report()
        }
        const before = await report()
        const source = await options.source().catch(() => null)
        if (!source || !marketReady(source.market, now(), asset)) return before
        await Promise.allSettled(ROLES.map(async role => {
          const contributor = before.contributors.find(c => c.source === role)!
          if (contributor.state === 'ready' || contributor.state === 'running') return
          try { await runner!.run(role); dispatchErrors.delete(role) }
          catch { dispatchErrors.set(role, '原生研究任务未能启动，可单独重试；其他研究仍会继续。') }
        }))
        return report()
      })().finally(() => { pending = null })
      return pending
    },
  }
}

export type ResearchLoopService = ReturnType<typeof createResearchLoop>
