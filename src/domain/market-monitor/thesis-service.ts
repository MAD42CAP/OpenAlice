import { z } from 'zod'
import { MARKET_MONITOR_ASSETS, type MarketMonitorAsset, type MarketMonitorSnapshot } from './types.js'
import { collectThesisEvidence, evaluateThesis, freshEvidence } from './thesis.js'
import { createThesisStore, thesisHash, thesisRecordHash, ThesisConflict, type ThesisStore } from './thesis-store.js'
import { THESIS_METRICS, thesisMetricAllowed, type ThesisDraft, type ThesisRevision, type ThesisCheck, type ThesisReport } from './thesis-types.js'
import type { DashboardObservation } from './dashboard-types.js'

const conditionSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), label: z.string().trim().min(1).max(200), kind: z.enum(['support', 'invalidate']), metric: z.enum(THESIS_METRICS), operator: z.enum(['gt', 'gte', 'lt', 'lte']), threshold: z.number().finite().min(-1e12).max(1e12).nullable() }).strict()
export const thesisSaveSchema = z.object({ asset: z.enum(MARKET_MONITOR_ASSETS), expectedRevision: z.number().int().min(0).max(99999998),
  draft: z.object({ thesis: z.string().trim().min(1).max(2000), horizon: z.string().trim().min(1).max(100), enabled: z.boolean(), changeNote: z.string().trim().min(1).max(300), conditions: z.array(conditionSchema).min(1).max(12) }).strict(),
}).strict().superRefine((input, ctx) => {
  if (new Set(input.draft.conditions.map(c => c.id)).size !== input.draft.conditions.length) ctx.addIssue({ code: 'custom', message: 'Duplicate condition identity' })
  for (const c of input.draft.conditions) {
    if (!thesisMetricAllowed(input.asset, c.metric) || c.metric !== 'manual' && c.threshold === null || c.metric === 'manual' && c.threshold !== null) ctx.addIssue({ code: 'custom', message: 'Invalid condition' })
    if (['daily-close', 'volume-ratio', 'put-call-ratio', 'strategy-mnav'].includes(c.metric) && c.threshold !== null && c.threshold < 0) ctx.addIssue({ code: 'custom', message: 'Negative level' })
  }
})

export function createThesisService(deps: {
  snapshot: (asset: MarketMonitorAsset) => Promise<MarketMonitorSnapshot | null>
  research: (asset: MarketMonitorAsset) => Promise<DashboardObservation[]>
  store?: ThesisStore
  now?: () => Date
}) {
  const store = deps.store ?? createThesisStore(), now = deps.now ?? (() => new Date())
  const pending = new Map<MarketMonitorAsset, Promise<unknown>>()
  const failures = new Set<MarketMonitorAsset>()
  const serial = <T>(asset: MarketMonitorAsset, action: () => Promise<T>): Promise<T> => {
    const work = (pending.get(asset) ?? Promise.resolve()).catch(() => {}).then(action)
    pending.set(asset, work)
    void work.finally(() => { if (pending.get(asset) === work) pending.delete(asset) }).catch(() => {})
    return work
  }
  const check = async (asset: MarketMonitorAsset, snapshot?: MarketMonitorSnapshot) => {
    const revision = (await store.revisions(asset)).rows.at(-1)
    if (!revision || !revision.enabled) return
    const at = now()
    const prior = (await store.checks(asset)).rows.at(-1)
    const basis = snapshot ?? await deps.snapshot(asset)
    const research = revision.conditions.some(c => c.metric === 'strategy-mnav') ? await deps.research(asset) : []
    const allEvidence = collectThesisEvidence(asset, basis, research, at)
    const evidence = allEvidence.filter(e => revision.conditions.some(c => c.metric === e.metric)).map(e => {
      const old = prior?.evidence.find(p => p.metric === e.metric)
      // Semantic duplicate scans need not create a new market snapshot. Their
      // later thesis evidence still wins over that older snapshot after restart.
      return old?.observedAt && e.observedAt && Date.parse(old.observedAt) <= at.getTime() && Date.parse(old.observedAt) > Date.parse(e.observedAt) ? freshEvidence(old, at) : e
    })
    // Check identity follows actual evidence, not button clicks or poll time.
    const dedupKey = thesisHash({ revision: revision.recordHash, evidence: evidence.map(({ observedAt: _observedAt, ...e }) => e) })
    if (prior?.dedupKey !== dedupKey) {
      const row: ThesisCheck = { schemaVersion: 1, asset, revision, checkedAt: at.toISOString(), evidence, evaluation: evaluateThesis(revision, evidence, at), dedupKey, recordHash: '' }
      row.recordHash = thesisRecordHash(row)
      await store.appendCheck(row)
    }
    failures.delete(asset)
  }
  const report = async (asset: MarketMonitorAsset): Promise<ThesisReport> => {
    const [revisions, checks] = await Promise.all([store.revisions(asset), store.checks(asset)])
    const revision = revisions.rows.at(-1) ?? null, latest = checks.rows.at(-1), at = now()
    const matching = latest && revision?.recordHash === latest.revision.recordHash ? latest : null
    return { asset, generatedAt: at.toISOString(), revision,
      current: revision && !revision.enabled ? evaluateThesis(revision, matching?.evidence ?? [], at) : matching ? evaluateThesis(revision!, matching.evidence, at) : null,
      lastCheckedAt: matching?.checkedAt ?? null, checkError: failures.has(asset), revisions: revisions.rows,
      checks: checks.rows, truncated: revisions.truncated || checks.truncated }
  }
  return {
    report,
    async save(asset: MarketMonitorAsset, expectedRevision: number, draft: ThesisDraft) {
      const input = thesisSaveSchema.parse({ asset, expectedRevision, draft })
      await serial(asset, async () => {
        const last = (await store.revisions(asset)).rows.at(-1)
        if ((last?.revision ?? 0) !== expectedRevision) throw new ThesisConflict('Thesis changed')
        const row: ThesisRevision = { ...input.draft, schemaVersion: 1, asset, revision: expectedRevision + 1, createdAt: now().toISOString(), recordHash: '' }
        row.recordHash = thesisRecordHash(row)
        await store.publish(row)
        try { await check(asset) } catch { failures.add(asset) }
      })
      return report(asset)
    },
    async check(asset: MarketMonitorAsset) {
      await serial(asset, async () => { try { await check(asset) } catch (error) { failures.add(asset); throw error } })
      return report(asset)
    },
    async afterScan(snapshot: MarketMonitorSnapshot) {
      await serial(snapshot.asset, async () => { try { await check(snapshot.asset, snapshot) } catch { failures.add(snapshot.asset) } })
    },
  }
}
export type ThesisService = ReturnType<typeof createThesisService>
