import { closedBars } from './bar-policy.js'
import { returnChoice } from './forecast-history.js'
import { intelligenceRecordHash } from './investment.js'
import { createNativeForwardStore, nativeForwardCommitHash, nativeForwardHash, nativeForwardRecordHash } from './native-forward-store.js'
import { NATIVE_FORWARD_PROTOCOL, type NativeForwardCommit, type NativeForwardOutcome, type NativeForwardPublication, type NativeForwardReport, type NativeForwardRow, type NativeForwardSummary } from './native-forward-types.js'
import { firstPerOutcomeWindow } from './review-cohort.js'
import { reviewOutcomes, reviewSessionDate } from './review.js'
import { analysisInputHash, type MarketAnalysisArchive } from './replay.js'
import type { InvestmentInput, InvestmentSnapshot } from './investment-types.js'
import type { MarketMonitorStore } from './store.js'
import type { MarketMonitorAsset, MarketMonitorReceipt, TrendHorizon } from './types.js'

const horizons: TrendHorizon[] = ['short', 'medium', 'long']
const RECEIPT_LIMIT = 10_000
const stamp = (value: string) => Date.parse(value)
const sessions = (asset: MarketMonitorAsset, horizon: TrendHorizon) => horizon === 'short' ? 1 : horizon === 'medium' ? asset === 'BTC' ? 7 : 5 : asset === 'BTC' ? 30 : 20
const cohortKey = (row: NativeForwardRow) => JSON.stringify([row.analysisVersion, row.basis.strategyId, row.basis.strategyVersion])
const validTime = (value: string, at: Date) => Number.isFinite(stamp(value)) && stamp(value) <= at.getTime()
function assertPublicationTiming(snapshot: InvestmentSnapshot, at: Date): void {
  const issuedAt = new Date(snapshot.analysisTime), session = reviewSessionDate(snapshot.asset, snapshot.analysisTime)
  const boundaryBar = [{ date: session, open: 1, high: 1, low: 1, close: 1, volume: 1 }]
  if (!Number.isFinite(at.getTime()) || !validTime(snapshot.analysisTime, at) || at.getTime() - issuedAt.getTime() > 60_000
    || reviewSessionDate(snapshot.asset, at.toISOString()) !== session
    || closedBars(boundaryBar, snapshot.asset, '1d', issuedAt).length !== closedBars(boundaryBar, snapshot.asset, '1d', at).length) throw new Error('独立前瞻只能捕捉本次真正新发布的综合研判，不能跨日或跨收盘回填。')
}
function verifiedMarketArchive(archive: MarketAnalysisArchive | null, id: string): archive is MarketAnalysisArchive {
  if (!archive) return false
  const { input, snapshot } = archive
  return archive.schemaVersion === 1 && snapshot.id === id && input.asset === snapshot.asset && input.strategyId === snapshot.strategyId
    && snapshot.analysisInput?.hash === analysisInputHash(input) && input.strategyVersion === snapshot.analysisInput.strategyVersion
    && input.asOf === snapshot.capturedAt && Number.isFinite(stamp(input.asOf)) && snapshot.analysisBasis?.closedBarsOnly === true
}
type ReceiptIndex = Map<string, MarketMonitorReceipt[]>
function indexReceipts(receipts: MarketMonitorReceipt[]): ReceiptIndex {
  const index: ReceiptIndex = new Map()
  for (const receipt of receipts) if (receipt.snapshotId) {
    const list = index.get(receipt.snapshotId)
    if (list) list.push(receipt); else index.set(receipt.snapshotId, [receipt])
  }
  return index
}
function completedReceipt(archive: MarketAnalysisArchive, receipts: ReceiptIndex, at: Date): MarketMonitorReceipt | null {
  return receipts.get(archive.snapshot.id)?.find(r => r.outcome === 'stored' && r.asset === archive.input.asset
    && r.strategyId === archive.input.strategyId && r.requestedAt === archive.input.asOf && typeof r.completedAt === 'string'
    && validTime(r.completedAt, at) && stamp(r.completedAt) >= stamp(r.requestedAt)) ?? null
}

/** First daily publication, then first realised window globally, before version or direction filtering. */
export function summarizeNativeForward(rows: NativeForwardRow[], asset: MarketMonitorAsset): NativeForwardReport['cohorts'] {
  const sorted = rows.slice().sort((a, b) => a.issuedAt.localeCompare(b.issuedAt) || a.publicationId.localeCompare(b.publicationId))
  const seenSessions = new Set<string>()
  const daily = sorted.filter(row => {
    const session = reviewSessionDate(asset, row.issuedAt)
    if (seenSessions.has(session)) return false
    seenSessions.add(session); return true
  })
  const identities = new Map(rows.map(row => [cohortKey(row), row]))
  return [...identities].map(([key, identity]) => ({ analysisVersion: identity.analysisVersion, strategyId: identity.basis.strategyId, strategyVersion: identity.basis.strategyVersion,
    summaries: horizons.map((horizon): NativeForwardSummary => {
      const all = daily.map(row => ({ row, outcome: row.outcomes.find(o => o.horizon === horizon)! }))
      const local = all.filter(v => cohortKey(v.row) === key)
      const complete = all.filter(v => v.outcome.status === 'complete')
      const unique = firstPerOutcomeWindow(complete, v => ({ issuedAt: v.row.issuedAt, ...v.outcome })).filter(v => cohortKey(v.row) === key)
      const calls = (kind: 'unconditional' | 'conditional') => ({ scored: unique.filter(v => v.outcome.intentKind === kind && v.outcome.correct !== null).length, correct: unique.filter(v => v.outcome.intentKind === kind && v.outcome.correct === true).length })
      return { horizon, sessions: sessions(asset, horizon), total: local.length, pending: local.filter(v => v.outcome.status === 'pending').length,
        excluded: local.filter(v => ['missing-data', 'unverified'].includes(v.outcome.status)).length, uniqueWindows: unique.length,
        suppressedWindows: rows.filter(r => cohortKey(r) === key).length - local.length + local.filter(v => v.outcome.status === 'complete').length - unique.length,
        unconditional: calls('unconditional'), conditionalIntent: calls('conditional'), abstained: unique.filter(v => v.outcome.intentKind === 'abstain').length,
        conditions: { defined: unique.filter(v => v.outcome.conditions.defined).length, confirmationTriggered: unique.filter(v => v.outcome.conditions.confirmationAt !== null).length,
          invalidationTriggered: unique.filter(v => v.outcome.conditions.invalidationAt !== null).length, bothTriggered: unique.filter(v => v.outcome.conditions.confirmationAt && v.outcome.conditions.invalidationAt).length } }
    }) }))
}

export function createNativeForward(options: {
  market: Pick<MarketMonitorStore, 'archive' | 'snapshots' | 'receipts'>
  publication: (id: string) => Promise<InvestmentSnapshot | null>
  store?: ReturnType<typeof createNativeForwardStore>; root?: string; now?: () => Date
}) {
  const store = options.store ?? createNativeForwardStore(options.root), now = options.now ?? (() => new Date())
  const validate = (row: NativeForwardPublication, at: Date) => {
    const { snapshot, input } = row
    if (row.protocol !== NATIVE_FORWARD_PROTOCOL || row.schemaVersion !== 1 || row.id !== snapshot.id || row.asset !== snapshot.asset || input.market.asset !== row.asset
      || row.issuedAt !== snapshot.analysisTime || row.sessionDate !== reviewSessionDate(row.asset, row.issuedAt)
      || !validTime(row.issuedAt, at) || !validTime(input.market.retrievedAt, new Date(row.issuedAt)) || !validTime(input.market.analysisTime, new Date(row.issuedAt))
      || row.originInputHash !== nativeForwardHash(input) || snapshot.forwardValidation?.originInputHash !== row.originInputHash || snapshot.forwardValidation.protocol !== NATIVE_FORWARD_PROTOCOL
      || intelligenceRecordHash(snapshot) !== snapshot.recordHash || nativeForwardRecordHash(row) !== row.recordHash || snapshot.id !== `investment-${snapshot.inputHash}`
      || typeof row.basis.receiptId !== 'string' || !row.basis.receiptId.trim()
      || typeof row.basis.completedAt !== 'string' || !validTime(row.basis.completedAt, new Date(row.issuedAt))
      || row.basis.snapshotId !== input.market.snapshotId || snapshot.marketSnapshotId !== input.market.snapshotId || snapshot.researchSnapshotId !== (input.research?.id ?? null)
      || !horizons.every(h => snapshot.outlooks.filter(o => o.horizon === h).length === 1)) throw new Error('Native forward origin integrity check failed')
  }
  const archiveMatches = async (row: NativeForwardPublication, receipts: ReceiptIndex) => {
    const archive = await options.market.archive(row.basis.snapshotId)
    const receipt = verifiedMarketArchive(archive, row.basis.snapshotId) ? completedReceipt(archive, receipts, new Date(row.issuedAt)) : null
    return Boolean(verifiedMarketArchive(archive, row.basis.snapshotId) && archive.snapshot.asset === row.asset && archive.snapshot.analysisInput?.hash === row.basis.inputHash
      && archive.input.strategyId === row.basis.strategyId && archive.input.strategyVersion === row.basis.strategyVersion
      && validTime(archive.input.asOf, new Date(row.input.market.analysisTime))
      && receipt && receipt.id === row.basis.receiptId && receipt.completedAt === row.basis.completedAt
      && row.basis.provider === (archive.snapshot.sourceHealth.find(s => s.id === 'daily-bars')?.provider ?? null))
  }
  return {
    assertPublicationTiming: (snapshot: InvestmentSnapshot) => assertPublicationTiming(snapshot, now()),
    /** Prepare before the source commit. Never recover an orphan by backdating a later publication. */
    async capture(input: InvestmentInput, snapshot: InvestmentSnapshot): Promise<InvestmentSnapshot> {
      const existing = await store.read(snapshot.asset, snapshot.id)
      if (existing) throw new Error('独立前瞻档案已存在；未回填未发布的旧预测，请等待更新后的研究输入。')
      const at = now()
      assertPublicationTiming(snapshot, at)
      const archive = await options.market.archive(input.market.snapshotId)
      assertPublicationTiming(snapshot, now())
      if (!verifiedMarketArchive(archive, input.market.snapshotId)) throw new Error('综合研判缺少可验证的原始市场档案，未发布独立前瞻。')
      const receipts = await options.market.receipts(snapshot.asset, RECEIPT_LIMIT)
      assertPublicationTiming(snapshot, now())
      const receiptIndex = indexReceipts(receipts), receipt = completedReceipt(archive, receiptIndex, new Date(snapshot.analysisTime))
      if (!receipt) throw new Error('综合研判缺少发布前已完成的市场取得回执，未发布独立前瞻。')
      const originInputHash = nativeForwardHash(input)
      const frozen = structuredClone(snapshot)
      frozen.forwardValidation = { protocol: NATIVE_FORWARD_PROTOCOL, originInputHash }
      frozen.recordHash = intelligenceRecordHash(frozen)
      const row: NativeForwardPublication = { schemaVersion: 1, protocol: NATIVE_FORWARD_PROTOCOL, id: frozen.id, asset: frozen.asset, issuedAt: frozen.analysisTime,
        sessionDate: reviewSessionDate(frozen.asset, frozen.analysisTime), originInputHash, input: structuredClone(input), snapshot: frozen,
        basis: { snapshotId: archive.snapshot.id, inputHash: archive.snapshot.analysisInput!.hash, strategyId: archive.input.strategyId, strategyVersion: archive.input.strategyVersion,
          provider: archive.snapshot.sourceHealth.find(s => s.id === 'daily-bars')?.provider ?? null, receiptId: receipt.id, completedAt: receipt.completedAt! }, recordHash: '' }
      row.recordHash = nativeForwardRecordHash(row)
      validate(row, at)
      if (!await archiveMatches(row, receiptIndex)) throw new Error('Native forward market origin integrity check failed')
      assertPublicationTiming(snapshot, now())
      const saved = await store.save(row)
      assertPublicationTiming(snapshot, now())
      if (!saved.stored) throw new Error('独立前瞻存在竞争发布，未复用未公开的旧捕捉。')
      return saved.record.snapshot
    },
    async commit(snapshot: InvestmentSnapshot): Promise<void> {
      // This sample is taken immediately after source.save completes, never at
      // analysis start or from an existing source file during a later retry.
      const publishedAt = now()
      assertPublicationTiming(snapshot, publishedAt)
      const capture = await store.read(snapshot.asset, snapshot.id)
      assertPublicationTiming(snapshot, now())
      if (!capture || capture.snapshot.recordHash !== snapshot.recordHash) throw new Error('Native forward commit does not match its capture')
      validate(capture, publishedAt)
      const source = await options.publication(snapshot.id)
      assertPublicationTiming(snapshot, now())
      if (!source || source.recordHash !== snapshot.recordHash || intelligenceRecordHash(source) !== snapshot.recordHash) throw new Error('Native forward commit does not match its source publication')
      const receipt: NativeForwardCommit = { schemaVersion: 1, protocol: NATIVE_FORWARD_PROTOCOL, id: snapshot.id, asset: snapshot.asset,
        publishedAt: publishedAt.toISOString(), captureHash: capture.recordHash, snapshotHash: snapshot.recordHash, recordHash: '' }
      receipt.recordHash = nativeForwardCommitHash(receipt)
      const saved = await store.saveCommit(receipt)
      if (!saved.stored) throw new Error('独立前瞻发布回执已存在，未回填旧发布。')
    },
    async report(asset: MarketMonitorAsset, settings: { asOf?: string; limit?: number } = {}): Promise<NativeForwardReport> {
      const generated = now(), at = settings.asOf ? new Date(settings.asOf) : generated
      if (!Number.isFinite(at.getTime()) || at > generated) throw new Error('历史查询时间必须有效且不晚于当前时间。')
      const [listingResult, observationsResult, receiptsResult] = await Promise.allSettled([store.list(asset), options.market.snapshots(asset, 20_000), options.market.receipts(asset, RECEIPT_LIMIT)])
      if (listingResult.status === 'rejected' || observationsResult.status === 'rejected' || receiptsResult.status === 'rejected') {
        const readErrorReason = listingResult.status === 'rejected' ? 'registration-read-failed' as const : 'market-history-read-failed' as const
        return { protocol: NATIVE_FORWARD_PROTOCOL, asset, generatedAt: generated.toISOString(), asOf: settings.asOf ?? null,
          historyTruncated: false, rowsTruncated: false, invalidRecords: 0, orphanedRecords: 0, readError: true, readErrorReason,
          excludedSessions: [], rows: [], cohorts: [], current: null,
          note: readErrorReason === 'registration-read-failed' ? '独立前瞻登记暂不可读；当前评分不可用，已有综合研判与观点仍可查看。' : '独立前瞻市场历史暂不可读；当前评分不可用，已有综合研判与观点仍可查看。' }
      }
      const listing = listingResult.value, observations = observationsResult.value, receipts = receiptsResult.value
      const receiptIndex = indexReceipts(receipts)
      const visible = listing.records.filter(r => validTime(r.issuedAt, at))
      let invalidRecords = listing.invalidRecords + listing.records.filter(r => !Number.isFinite(stamp(r.issuedAt))).length, orphanedRecords = 0
      const excludedSessions = new Set<string>(), valid: NativeForwardPublication[] = []
      // If an unknown corrupt record may be the first daily call, suppress the full report.
      let unreliable = listing.truncated || invalidRecords > 0 || receipts.length >= RECEIPT_LIMIT
      for (const row of visible) {
        try {
          validate(row, at)
          const publication = await options.publication(row.id)
          if (!publication) { orphanedRecords++; excludedSessions.add(row.sessionDate); continue }
          if (publication.recordHash !== row.snapshot.recordHash || intelligenceRecordHash(publication) !== publication.recordHash || !await archiveMatches(row, receiptIndex)) throw new Error('origin')
          const receipt = await store.readCommit(asset, row.id)
          if (!receipt) { orphanedRecords++; excludedSessions.add(row.sessionDate); continue }
          if (receipt.captureHash !== row.recordHash || receipt.snapshotHash !== row.snapshot.recordHash || !validTime(receipt.publishedAt, generated)) throw new Error('commit')
          assertPublicationTiming(row.snapshot, new Date(receipt.publishedAt))
          if (!validTime(receipt.publishedAt, at)) continue
          valid.push(row)
        } catch { invalidRecords++; excludedSessions.add(row.sessionDate) }
      }
      // A failed Friday origin and a later Saturday call can share Monday's
      // realised window. Session-only exclusion would replace the first call.
      unreliable ||= invalidRecords > 0 || orphanedRecords > 0
      const usable = valid.filter(r => !excludedSessions.has(r.sessionDate)).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
      const rows: NativeForwardRow[] = []
      const historyTruncated = listing.truncated || observations.length === 20_000 || receipts.length >= RECEIPT_LIMIT
      let outcomeReceiptUnavailable = 0
      const series = new Map<string, MarketAnalysisArchive | null>()
      for (const publication of unreliable ? [] : usable) {
        if (!series.has(publication.basis.strategyId)) {
          let latest: MarketAnalysisArchive | null = null
          for (const observation of observations.filter(s => s.asset === asset && s.strategyId === publication.basis.strategyId && validTime(s.capturedAt, at)).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))) {
            try {
              const archive = await options.market.archive(observation.id)
              if (verifiedMarketArchive(archive, observation.id) && archive.snapshot.asset === asset && archive.snapshot.strategyId === publication.basis.strategyId
                && archive.snapshot.analysisInput?.hash === observation.analysisInput?.hash && archive.input.asOf === observation.capturedAt) {
                if (!completedReceipt(archive, receiptIndex, at)) { outcomeReceiptUnavailable++; continue }
                latest = archive; break
              }
            } catch { /* Corrupt outcome archives cannot supply future labels. */ }
          }
          series.set(publication.basis.strategyId, latest)
        }
        const outcomeArchive = series.get(publication.basis.strategyId) ?? null
        const outcomeSnapshot = outcomeArchive?.snapshot ?? null
        // Forming bars in an old chart never become known historical closes
        // merely because the report clock later advances.
        const outcomeAt = at
        const bars = outcomeArchive ? closedBars(outcomeArchive.input.dailyBars, asset, '1d', new Date(outcomeArchive.input.asOf)) : []
        const outcomes = reviewOutcomes({ id: publication.id, kind: 'narration', snapshotId: publication.basis.snapshotId, issuedAt: publication.issuedAt,
          sessionDate: publication.sessionDate, strategyVersion: publication.basis.strategyVersion, archiveStatus: 'verified', original: null,
          narration: null, originalProvider: publication.basis.provider, outcomeProvider: null, providerChanged: false, path: [], outcomes: [] }, asset, bars, outcomeAt)
          .map((outcome): NativeForwardOutcome => {
            const outlook = publication.snapshot.outlooks.find(o => o.horizon === outcome.trendHorizon)!
            const intent = outlook.direction.includes('bullish') ? 'up' : outlook.direction.includes('bearish') ? 'down' : null
            const intentKind = !intent ? 'abstain' : outlook.direction.startsWith('conditional-') ? 'conditional' : 'unconditional'
            const actual = outcome.status === 'complete' ? returnChoice(outcome.entry!, outcome.close!) : null
            const pair = outlook.decisionConditions
            const path = closedBars(bars, asset, '1d', outcomeAt).filter(b => b.date.slice(0, 10) > publication.sessionDate).sort((a, b) => a.date.localeCompare(b.date)).slice(0, outcome.targetBars)
            const trigger = (kind: 'confirmation' | 'invalidation') => {
              const c = pair?.[kind]
              if (!c || c.metric !== 'daily-close' || !['gt', 'lt'].includes(c.operator) || ['missing-data', 'unverified'].includes(outcome.status)) return null
              return path.find(b => c.operator === 'gt' ? b.close > c.threshold : b.close < c.threshold)?.date.slice(0, 10) ?? null
            }
            return { horizon: outcome.trendHorizon, sessions: outcome.targetBars, status: outcome.status, start: outcome.start, end: outcome.end,
              entry: outcome.entry, close: outcome.close, changePercent: outcome.changePercent, actual, intent, intentKind,
              correct: actual && intent ? actual === intent : null, conditions: { defined: Boolean(pair), confirmationAt: trigger('confirmation'), invalidationAt: trigger('invalidation') } }
          })
        const outcomeProvider = outcomeSnapshot?.sourceHealth.find(s => s.id === 'daily-bars')?.provider ?? null
        rows.push({ publicationId: publication.id, issuedAt: publication.issuedAt, analysisVersion: publication.snapshot.analysisVersion, basis: publication.basis,
          outcomeSnapshotId: outcomeSnapshot?.id ?? null, outcomeProvider, providerChanged: Boolean(outcomeProvider && outcomeProvider !== publication.basis.provider), outcomes })
      }
      const limit = Math.max(1, Math.min(500, settings.limit ?? 100))
      const cohorts = summarizeNativeForward(rows, asset)
      const latest = visible.slice().sort((a, b) => b.issuedAt.localeCompare(a.issuedAt) || b.id.localeCompare(a.id))[0]
      const latestRow = !unreliable && latest && !excludedSessions.has(latest.sessionDate) ? rows.find(r => r.publicationId === latest.id) : null
      const current = latestRow ? cohorts.find(c => c.analysisVersion === latestRow.analysisVersion && c.strategyId === latestRow.basis.strategyId && c.strategyVersion === latestRow.basis.strategyVersion) ?? null : null
      return { protocol: NATIVE_FORWARD_PROTOCOL, asset, generatedAt: generated.toISOString(), asOf: settings.asOf ?? null,
        historyTruncated, rowsTruncated: rows.length > limit, invalidRecords, orphanedRecords, readError: false, outcomeReceiptUnavailable, excludedSessions: [...excludedSessions].sort(),
        rows: rows.slice(-limit), cohorts, current,
        note: `独立实验：仅新发布首页综合研判；同日及相同真实窗口保留最早发布，再按版本分组。中性与不确定均弃权；有条件方向仅统计实验方向意图。条件触发不是收益命中；固定未来开盘至收盘以±0.25%分涨平跌，重叠窗口不独立。旧记录不回填。${outcomeReceiptUnavailable ? ` ${outcomeReceiptUnavailable} 个结算档案缺少查询时可用的市场完成回执，未用于评分。` : ''}` }
    },
  }
}
