import { dataPath } from '../../core/paths.js'
import type { MarketMonitorAsset } from './types.js'
import { createHash } from 'node:crypto'
import { createInvestmentStore } from './investment-store.js'
import { evaluateInvestmentThesis, guardInvestmentDraft, intelligenceRecordHash, investmentDraftSchema, investmentInputHash } from './investment.js'
import { investmentAnalysisVersion, type InvestmentDraft, type InvestmentInput, type InvestmentReport, type InvestmentSnapshot, type InvestmentThesis, type InvestmentThesisDraft, type InvestmentThesisEvaluation } from './investment-types.js'
import type { IntelligenceProvenance } from './intelligence-types.js'
import { researchLoopProtocol } from './research-loop-types.js'
import { createNativeForward } from './native-forward.js'
import type { MarketMonitorStore } from './store.js'
import { createNativeForwardStore } from './native-forward-store.js'
import { readInvestmentExplanation } from './investment-explanation.js'

const stamp = (s: string) => Date.parse(s)
const before = (value: string | null, at: Date) => value !== null && Number.isFinite(stamp(value)) && stamp(value) <= at.getTime()
export function createInvestmentService(options: { asset?: MarketMonitorAsset; root?: string; now?: () => Date;
  nativeForward?: { market: Pick<MarketMonitorStore, 'archive' | 'snapshots' | 'receipts'>; root?: string }
} = {}) {
  const asset = options.asset ?? 'BTC'
  const store = createInvestmentStore(options.root ?? (asset === 'BTC' ? undefined : dataPath('market-monitor', 'investment-intelligence-v1', asset.toLowerCase())))
  const now = options.now ?? (() => new Date())
  const nativeForward = options.nativeForward ? createNativeForward({ ...options.nativeForward, now, publication: id => store.read('publications', id) }) : null
  const explanationOrigins = options.nativeForward ? createNativeForwardStore(options.nativeForward.root) : null
  // One process serializes publications and automatic objective checks. Atomic
  // immutable files also prevent partial records under competing processes.
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(work: () => Promise<T>): Promise<T> => { const next = queue.catch(() => undefined).then(work); queue = next; return next }
  const revalidateInternal = async (market: InvestmentInput['market'], at: Date): Promise<InvestmentThesisEvaluation[]> => {
    if (!before(market.retrievedAt, at) || market.asset !== asset) throw new Error('观点跟踪不能使用未来市场资料。')
    const [theses, saved] = await Promise.all([store.list('theses'), store.list('evaluations')])
    const results: InvestmentThesisEvaluation[] = []
    for (const thesis of theses.filter(t => before(t.createdAt, at))) {
      const previous = saved.filter(e => e.thesisId === thesis.id && before(e.evaluatedAt, at)).sort((a, b) => a.evaluatedAt.localeCompare(b.evaluatedAt)).at(-1) ?? null
      if (previous && ['INVALIDATED', 'RESOLVED', 'EXPIRED'].includes(previous.status)) continue
      const evaluation = evaluateInvestmentThesis(thesis, market, previous, at)
      // Identical evidence/status should not manufacture daily state changes.
      const existing = await store.read('evaluations', evaluation.id)
      if (existing) { results.push(existing); continue }
      const { record } = await store.save('evaluations', evaluation)
      saved.push(record); results.push(record)
    }
    return results
  }
  const initializeTheses = async (snapshot: InvestmentSnapshot) => {
    for (const draft of snapshot.theses) {
      // A stable key is an immutable initial hypothesis. A new AI prose run
      // cannot revise its predeclared conditions or revive a terminal idea.
      const thesisId = `thesis-${createHash('sha256').update(asset === 'BTC' ? draft.key : `${asset}:${draft.key}`).digest('hex')}`
      if (await store.read('theses', thesisId)) continue
      const ids = new Set([...draft.claim.evidenceIds, ...[...draft.supportConditions, ...draft.invalidationConditions, ...draft.resolutionConditions].flatMap(c => c.thresholdEvidenceId ? [c.thresholdEvidenceId] : [])])
      const thesis: InvestmentThesis = { ...structuredClone(draft), id: thesisId, revision: 1, createdAt: snapshot.analysisTime, expiresAt: new Date(Date.parse(snapshot.analysisTime) + draft.observationDays * 86_400_000).toISOString(), investmentSnapshotId: snapshot.id, evidence: snapshot.evidence.filter(e => ids.has(e.id)), recordHash: '' }
      thesis.recordHash = intelligenceRecordHash(thesis)
      await store.save('theses', thesis)
    }
  }
  return {
    publish(input: InvestmentInput, value: unknown, provenance: IntelligenceProvenance) {
      return serialized(async () => {
        const at = now()
        if (![provenance.workspaceId, provenance.runId, provenance.issueId, provenance.agent].every(s => typeof s === 'string' && s.trim().length > 0)) throw new Error('缺少原生工作区调用来源。')
        if (input.market.asset !== asset) throw new Error('综合研判标的与归档空间不匹配。')
        const rawDraft = investmentDraftSchema.parse(value) as InvestmentDraft
        const { draft, warnings, evidence } = guardInvestmentDraft(input, rawDraft, at)
        const inputHash = investmentInputHash(input, at), id = `investment-${inputHash}`
        const existing = await store.read('publications', id)
        if (existing) { await initializeTheses(existing); await revalidateInternal(input.market, at); return { stored: false, snapshot: existing } }
        const publications = (await store.list('publications')).filter(p => before(p.analysisTime, at)).sort((a, b) => a.analysisTime.localeCompare(b.analysisTime))
        const previous = publications.at(-1) ?? null
        const existingIdeas = await store.list('theses')
        for (const idea of draft.theses) {
          const original = existingIdeas.find(t => t.key === idea.key)
          if (!original) continue
          const conditions = (t: InvestmentThesisDraft) => JSON.stringify({ support: t.supportConditions, invalidate: t.invalidationConditions, resolve: t.resolutionConditions, days: t.observationDays })
          if (conditions(original) !== conditions(idea)) warnings.push(`观点 ${idea.key} 已建档，原确认/失效条件及期限保持不变；新提案仅留在本次原始 AI 输出中，不重置客观跟踪。`)
        }
        const changes: InvestmentSnapshot['changes'] = []
        for (const outlook of draft.outlooks) {
          const prior = previous?.outlooks.find(o => o.horizon === outlook.horizon)
          if (prior && prior.direction !== outlook.direction) {
            const cited = outlook.conclusion.evidenceIds.map(id => evidence.find(e => e.id === id)!).filter(Boolean)
            const changeEvidenceIds = new Set(outlook.conclusion.evidenceIds)
            const preservePrevious = (ref: typeof evidence[number]) => {
              changeEvidenceIds.add(ref.id)
              if (!evidence.some(e => e.id === ref.id)) evidence.push(structuredClone(ref))
            }
            const observedChanges = cited.flatMap(e => {
              const priorRefs = prior.conclusion.evidenceIds.map(id => previous!.evidence.find(p => p.id === id)).filter(p => p !== undefined)
              const old = e.reportId
                ? priorRefs.find(p => p.reportId && p.sourceName === e.sourceName) ?? previous!.evidence.find(p => p.reportId && p.sourceName === e.sourceName)
                : previous!.evidence.find(p => p.metric === e.metric && p.sourceName === e.sourceName && !p.reportId)
              if (e.reportId && old?.reportId && e.reportId !== old.reportId) {
                preservePrevious(old)
                return [`引用报告更新 ${e.sourceName}：${old.reportId} → ${e.reportId}；本期段落 ${e.id}（截止 ${e.dataAsOf ?? '未知'}）`]
              }
              if (e.reportId && !previous!.evidence.some(p => p.id === e.id)) {
                if (old) preservePrevious(old)
                return [`${old ? '同一报告新增引用段落' : '新增报告引用'} ${e.sourceName}/${e.reportId}：${e.id}（截止 ${e.dataAsOf ?? '未知'}）`]
              }
              if (!old) return [`新增 ${e.sourceName}/${e.metric}（截止 ${e.dataAsOf ?? '未知'}）`]
              if (old.value !== e.value) { preservePrevious(old); return [`${e.metric}: ${String(old.value)} → ${String(e.value)}`] }
              return []
            })
            if (!observedChanges.length) warnings.push(`${outlook.horizon} 方向调整，但引用指标值没有可验证的新变化；属于解释调整。`)
            changes.push({ horizon: outlook.horizon, previous: prior.direction, current: outlook.direction, evidenceIds: [...changeEvidenceIds],
              explanation: `${observedChanges.length ? observedChanges.join('；') : '引用指标值无可验证的新变化，属于 AI 解释调整。'} AI 解释：${outlook.conclusion.text}` })
          }
        }
        const snapshot: InvestmentSnapshot = { ...draft, schemaVersion: 1, id, asset, analysisVersion: investmentAnalysisVersion(asset), analysisTime: at.toISOString(), marketSnapshotId: input.market.snapshotId, researchSnapshotId: input.research?.id ?? null,
          inputHash, previousSnapshotId: previous?.id ?? null, provenance: structuredClone(provenance), analysisModel: provenance.model ?? null, evidence: structuredClone(evidence), rawDraft: structuredClone(rawDraft), guardWarnings: warnings, changes,
          ...(input.researchFeedback && draft.feedbackReview ? { researchFeedback: { protocol: researchLoopProtocol(asset), contextHash: input.researchFeedback.hash, ...structuredClone(draft.feedbackReview) } } : {}), recordHash: '' }
        snapshot.recordHash = intelligenceRecordHash(snapshot)
        // Capture first, then commit exactly the same guarded snapshot. A failed
        // source commit remains an explicitly unscored orphan, never a backfill.
        const captured = nativeForward ? await nativeForward.capture(input, snapshot) : snapshot
        nativeForward?.assertPublicationTiming(captured)
        const published = await store.save('publications', captured)
        if (nativeForward && published.record.recordHash !== captured.recordHash) throw new Error('独立前瞻与真实综合研判发布不一致，未将竞争记录计为命中。')
        if (nativeForward) await nativeForward.commit(published.record)
        await initializeTheses(published.record)
        await revalidateInternal(input.market, at)
        return { stored: published.stored, snapshot: published.record }
      })
    },
    revalidate(market: InvestmentInput['market']) { return serialized(() => revalidateInternal(market, now())) },
    async report(options: { asOf?: string; limit?: number } = {}): Promise<InvestmentReport> {
      const generated = now(), at = options.asOf ? new Date(options.asOf) : generated
      if (!Number.isFinite(at.getTime()) || at.getTime() > generated.getTime()) throw new Error('历史查询时间必须有效且不晚于当前时间。')
      const [saved, ideas, checks] = await Promise.all([store.list('publications'), store.list('theses'), store.list('evaluations')])
      // An as-of query returns what was actually generated and acquired then.
      // Never rerun old claims using a report imported or analyzed afterward.
      const history = saved.filter(p => p.asset === asset && before(p.analysisTime, at) && p.evidence.every(e => before(e.retrievedAt, at) && (e.publishedAt === null || before(e.publishedAt, at)))).sort((a, b) => b.analysisTime.localeCompare(a.analysisTime))
      const publicationIds = new Set(history.map(p => p.id))
      const evaluations = checks.filter(e => before(e.evaluatedAt, at) && e.evidence.every(r => before(r.retrievedAt, at))).sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt))
      const theses = ideas.filter(t => before(t.createdAt, at) && publicationIds.has(t.investmentSnapshotId)).map(t => { const latestEvaluation = evaluations.find(e => e.thesisId === t.id) ?? null; return { ...t, status: latestEvaluation?.status ?? 'ACTIVE' as const, latestEvaluation } })
      const resolved = theses.filter(t => t.status === 'RESOLVED').length, invalidated = theses.filter(t => t.status === 'INVALIDATED').length, expired = theses.filter(t => t.status === 'EXPIRED').length
      const completed = theses.filter(t => ['RESOLVED', 'INVALIDATED', 'EXPIRED'].includes(t.status))
      const durations = completed.map(t => (stamp(t.status === 'EXPIRED' ? t.expiresAt : t.latestEvaluation!.evaluatedAt) - stamp(t.createdAt)) / 86_400_000)
      const limit = Math.max(1, Math.min(200, options.limit ?? 50))
      const latest = history[0] ?? null
      return { schemaVersion: 1, generatedAt: generated.toISOString(), asOf: options.asOf ?? null, latest, history: history.slice(0, limit), theses, evaluations: evaluations.filter(e => theses.some(t => t.id === e.thesisId)).slice(0, 500),
        quality: { total: theses.length, active: theses.filter(t => t.status === 'ACTIVE').length, resolved, invalidated, expired, unresolved: theses.length - resolved - invalidated - expired, conditionDefined: theses.filter(t => t.supportConditions.length > 0 && t.invalidationConditions.length > 0).length, stateChanges: evaluations.filter(e => e.status !== e.previousStatus && theses.some(t => t.id === e.thesisId)).length, meanDurationDays: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null, directionalAccuracy: null, note: '这是预声明客观条件的研究质量追踪；CONFIRMED 只表示证据支持，不是方向命中率。定性短中长期观点未定义收益阈值，不计算预测准确率。' },
        ...(nativeForward ? { nativeForward: await nativeForward.report(asset, options) } : {}),
        explanation: latest ? await readInvestmentExplanation(latest, explanationOrigins, at) : null }
    },
  }
}
