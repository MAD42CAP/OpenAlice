import { randomUUID } from 'node:crypto'
import { createTypeSafeClient, TypeSafeError, TYPESAFE_MODEL, type JevResult } from './typesafe-client.js'
import { createTypeSafeStore } from './typesafe-store.js'
import { createMarketMonitorStore, type MarketMonitorStore } from './store.js'
import type { MarketMonitorService } from './service.js'
import { buildGuardedMarketJudgment, buildSessionGuardedMarketJudgment } from './judgment.js'
import { buildForwardValidationInput, guardedJevDecision, validForwardAnswer } from './forecast-validation-input.js'
import { createForecastValidationStore, forwardRecordHash } from './forecast-validation-store.js'
import { FORWARD_PROTOCOL, JEV_DECISION_POLICY, type ForwardCandidate, type ForwardMethod, type ForwardPublication, type ForwardProtocol, type ForwardReport, type ForwardRow } from './forecast-validation-types.js'
import { hashJevInput } from './typesafe-input.js'
import { JEV_HORIZONS, type JevHorizon } from './typesafe-types.js'
import { analysisInputHash, type MarketAnalysisArchive } from './replay.js'
import { reviewOutcomes, reviewSessionDate } from './review.js'
import { firstPerOutcomeWindow } from './review-cohort.js'
import { returnChoice } from './forecast-history.js'
import { analyzeForwardValidation, forwardCohort } from './forecast-validation-analytics.js'
import { createMarketMonitorStrategyRegistry } from './strategy.js'
import type { ReturnChoice } from './forecast-experiment-types.js'
import type { MarketMonitorAsset } from './types.js'

const methods: ForwardMethod[] = ['rules', 'jev', 'combined', 'frequency', 'alwaysUp']
const direction = (value: string): ReturnChoice | null => value === 'bullish' ? 'up' : value === 'bearish' ? 'down' : null
const timestamp = (value: string) => typeof value === 'string' ? Date.parse(value) : NaN
const frequencyChoice = (probabilities: Record<ReturnChoice, number> | null): ReturnChoice | null => {
  if (!probabilities) return null
  const choices = (['up', 'flat', 'down'] as const).filter(key => probabilities[key] === Math.max(...Object.values(probabilities)))
  return choices.length === 1 ? choices[0]! : null
}
const safeMessage = (error: unknown) => error instanceof TypeSafeError ? error.message : '新版前向验证暂不可用，原有行情与历史记录不受影响。'
const invalid = (message = '新版验证记录的身份、时序或输入无法验证，原记录未被覆盖。'): never => { throw new TypeSafeError('integrity', message) }

/** Probability scoring deliberately uses all valid raw distributions, including
 * abstentions. Directional coverage and common-call accuracy are separate. */
export function summarizeForwardValidation(rows: ForwardRow[]): ForwardReport['summaries'] {
  return JEV_HORIZONS.map(horizon => {
    const all = rows.map(row => ({ issuedAt: row.issuedAt, ...row.outcomes.find(outcome => outcome.horizon === horizon)! }))
    const complete = all.filter(row => row.outcome.status === 'complete')
    const unique = firstPerOutcomeWindow(complete, row => ({ issuedAt: row.issuedAt, ...row.outcome }))
    const probability = unique.filter(row => row.brier.jev !== null && row.brier.frequency !== null)
    const matched = unique.filter(row => methods.every(method => row.correct[method] !== null))
    return {
      horizon, total: all.length, complete: complete.length, pending: all.filter(row => row.outcome.status === 'pending').length,
      excluded: all.filter(row => row.outcome.status === 'unverified' || row.outcome.status === 'missing-data').length,
      uniqueWindows: unique.length, duplicateWindows: complete.length - unique.length,
      methods: Object.fromEntries(methods.map(method => [method, {
        scored: unique.filter(row => row.correct[method] !== null).length,
        correct: unique.filter(row => row.correct[method] === true).length,
        abstained: unique.filter(row => row.choices[method] === null).length,
      }])) as ForwardReport['summaries'][number]['methods'],
      probability: { count: probability.length,
        jevBrier: probability.length ? probability.reduce((sum, row) => sum + row.brier.jev!, 0) / probability.length : null,
        frequencyBrier: probability.length ? probability.reduce((sum, row) => sum + row.brier.frequency!, 0) / probability.length : null },
      matched: { count: matched.length, correct: Object.fromEntries(methods.map(method => [method, matched.filter(row => row.correct[method]).length])) as Record<ForwardMethod, number> },
    }
  })
}

function validatePublication(row: ForwardPublication, asset: MarketMonitorAsset, session: string, at: Date, protocol: ForwardProtocol): void {
  const combinedProtocol = protocol !== 'market-forward-v2' ? 'evidence-summary-v3' : 'evidence-summary-v2'
  const combinedDecisionPolicy = protocol !== 'market-forward-v2' ? 'guarded-price-evidence-v3' : 'guarded-price-evidence-v2'
  if (!row || row.schemaVersion !== 1 || row.protocol !== protocol || row.asset !== asset || typeof row.id !== 'string' || !row.id
    || !Number.isFinite(timestamp(row.issuedAt)) || timestamp(row.issuedAt) > at.getTime() || reviewSessionDate(asset, row.issuedAt) !== session
    || forwardRecordHash(row) !== row.recordHash || !row.basis || !Number.isFinite(timestamp(row.basis.capturedAt)) || timestamp(row.basis.capturedAt) > timestamp(row.issuedAt)
    || !Number.isInteger(row.basis.strategyVersion) || row.basis.strategyVersion < 1
    || protocol !== 'market-forward-v2' && asset !== 'BTC' && row.basis.strategyVersion < 3
    || !row.input || hashJevInput(row.input) !== row.inputHash || row.input.state.asset !== asset || row.input.state.evidenceCapturedAt !== row.basis.capturedAt
    || row.input.state.forecastProtocol !== protocol || row.input.state.requestAt !== row.issuedAt
    || !Number.isFinite(timestamp(row.input.state.requestAt as string)) || timestamp(row.input.state.requestAt as string) > timestamp(row.issuedAt)
    || timestamp(row.input.state.requestAt as string) < timestamp(row.basis.capturedAt)
    || !row.policy || Object.entries(JEV_DECISION_POLICY).some(([key, value]) => row.policy[key as keyof typeof JEV_DECISION_POLICY] !== value)
    || row.policy.combinedDecisionPolicy !== combinedDecisionPolicy || row.policy.combinedProtocol !== combinedProtocol || row.combined?.protocol !== combinedProtocol
    || row.combined.asset !== asset || row.combined.snapshotId !== row.basis.snapshotId || row.combined.strategyId !== row.basis.strategyId
    || row.combined.basis.capturedAt !== row.basis.capturedAt || row.combined.validation?.policy !== combinedProtocol || row.combined.validation.status !== 'experimental'
    || !Number.isFinite(timestamp(row.combined.generatedAt)) || timestamp(row.combined.generatedAt) > timestamp(row.issuedAt)
    || JEV_HORIZONS.some(h => {
      const history = row.input.history[h], combined = row.combined.horizons[h]
      const periods = h === 'short' ? 1 : h === 'medium' ? asset === 'BTC' ? 7 : 5 : asset === 'BTC' ? 30 : 20
      if (!history || !combined || ![null, 'up', 'down'].includes(row.rules[h]) || !['directional', 'conditional', 'abstain'].includes(combined.decision ?? '')
        || combined.decision === 'directional' && direction(combined.direction) === null || combined.sessions !== periods || history.sessions !== periods
        || !Number.isInteger(history.samples) || history.samples < 0) return true
      const prior = history.probabilities
      if (history.samples === 0) { if (prior !== null) return true }
      else if (!prior || Object.keys(prior).length !== 3 || !['up', 'flat', 'down'].every(key => typeof prior[key as ReturnChoice] === 'number' && Number.isFinite(prior[key as ReturnChoice]) && prior[key as ReturnChoice] >= 0 && prior[key as ReturnChoice] <= 1)
        || Math.abs(prior.up + prior.flat + prior.down - 1) > 0.001 || !Number.isFinite(timestamp(history.firstEntryAt!)) || !Number.isFinite(timestamp(history.lastExitAt!))
        || timestamp(history.firstEntryAt!) > timestamp(history.lastExitAt!) || timestamp(history.lastExitAt!) > timestamp(row.basis.capturedAt)) return true
      return [h, `${h}Evidence`, `${h}Signal`].some(key => row.input.questions[key]?.type !== 'choice')
    })) invalid()
}

function validateCandidate(row: ForwardCandidate, publication: ForwardPublication, at: Date): void {
  if (!row || row.schemaVersion !== 1 || row.protocol !== publication.protocol || row.publicationId !== publication.id || row.inputHash !== publication.inputHash
    || forwardRecordHash(row) !== row.recordHash || !Number.isFinite(timestamp(row.requestedAt)) || !Number.isFinite(timestamp(row.issuedAt))
    || timestamp(row.requestedAt) < timestamp(publication.issuedAt) || timestamp(row.issuedAt) < timestamp(row.requestedAt) || timestamp(row.issuedAt) > at.getTime()
    || reviewSessionDate(publication.asset, row.requestedAt) !== reviewSessionDate(publication.asset, publication.issuedAt)
    || reviewSessionDate(publication.asset, row.issuedAt) !== reviewSessionDate(publication.asset, publication.issuedAt)
    || !validResult(row.raw)
    || JEV_HORIZONS.some(h => hashJevInput(row.decisions?.[h]) !== hashJevInput(guardedJevDecision(row.raw, h, publication.input.history[h])))) invalid()
}

function validResult(raw: JevResult): boolean {
  return Boolean(raw && raw.model === TYPESAFE_MODEL && raw.answers && typeof raw.answers === 'object' && Number.isInteger(raw.inputTokens) && raw.inputTokens >= 0
    && Number.isFinite(raw.durationMs) && raw.durationMs >= 0)
}

function verifiedArchive(archive: MarketAnalysisArchive | null, publication: ForwardPublication): archive is MarketAnalysisArchive {
  return Boolean(archive && archive.schemaVersion === 1 && archive.snapshot.id === publication.basis.snapshotId && archive.snapshot.asset === publication.asset
    && archive.input.asset === publication.asset && archive.snapshot.strategyId === publication.basis.strategyId && archive.input.strategyId === publication.basis.strategyId
    && archive.snapshot.analysisInput?.hash === publication.basis.inputHash && analysisInputHash(archive.input) === publication.basis.inputHash
    && archive.input.strategyVersion === publication.basis.strategyVersion && archive.snapshot.analysisInput.strategyVersion === publication.basis.strategyVersion
    && archive.snapshot.capturedAt === publication.basis.capturedAt && archive.input.asOf === publication.basis.capturedAt
    && archive.snapshot.analysisBasis?.closedBarsOnly === true
    && (publication.protocol === 'market-forward-v2' || publication.asset === 'BTC' || archive.snapshot.analysisBasis.version === 3)
    && publication.basis.provider === (archive.snapshot.sourceHealth.find(source => source.id === 'daily-bars')?.provider ?? null)
    && JEV_HORIZONS.every(h => publication.rules[h] === direction(archive.snapshot.trend?.[h].direction ?? 'insufficient'))
    && timestamp(archive.input.asOf) <= timestamp(publication.issuedAt))
}

export function createForecastValidation(deps: {
  monitor: Pick<MarketMonitorService, 'scan' | 'settings' | 'snapshots'> & Partial<Pick<MarketMonitorService, 'strategies'>>
  protocol?: ForwardProtocol
  market?: MarketMonitorStore; store?: ReturnType<typeof createForecastValidationStore>
  credentials?: Pick<ReturnType<typeof createTypeSafeStore>, 'config' | 'settings'>
  client?: ReturnType<typeof createTypeSafeClient>; now?: () => Date
}) {
  const protocol = deps.protocol ?? FORWARD_PROTOCOL
  const market = deps.market ?? createMarketMonitorStore(), store = deps.store ?? createForecastValidationStore(undefined, protocol)
  const credentials = deps.credentials ?? createTypeSafeStore(), client = deps.client ?? createTypeSafeClient(), now = deps.now ?? (() => new Date())
  const pending = new Map<MarketMonitorAsset, { allowModel: boolean; task: Promise<ForwardPublication> }>()
  const errors = new Map<MarketMonitorAsset, string>()
  const retryAfter = new Map<MarketMonitorAsset, { session: string; until: number }>()
  const automaticDone = new Map<MarketMonitorAsset, string>()

  const collect = (asset: MarketMonitorAsset, refresh = true, allowModel = true): Promise<ForwardPublication> => {
    const running = pending.get(asset)
    if (running) return allowModel && !running.allowModel ? running.task.then(() => collect(asset, refresh, true)) : running.task
    const task = (async () => {
      const session = reviewSessionDate(asset, now().toISOString())
      let publication = await store.publication(asset, session)
      if (!publication) {
        const strategy = (await deps.monitor.settings()).strategyId
        const snapshot = refresh ? (await deps.monitor.scan(asset, 'manual')).snapshot : (await deps.monitor.snapshots(asset, 1, strategy)).at(-1)
        if (!snapshot) throw new TypeSafeError('basis', '请先完成一次行情扫描，才能冻结新版验证。')
        const archive = await market.archive(snapshot.id)
        if (!archive || snapshot.id !== archive.snapshot.id || snapshot.asset !== asset || snapshot.strategyId !== strategy || archive.input.asset !== asset
          || archive.input.strategyId !== strategy || archive.snapshot.analysisInput?.hash !== analysisInputHash(archive.input)
          || snapshot.analysisInput?.hash !== archive.snapshot.analysisInput.hash || archive.input.asOf !== snapshot.capturedAt) {
          throw new TypeSafeError('basis', '本次扫描缺少可验证的原始行情档案，未请求模型。')
        }
        const requestAt = now(), input = buildForwardValidationInput(archive, requestAt, protocol)
        const combined = protocol !== 'market-forward-v2' ? buildSessionGuardedMarketJudgment(archive.snapshot, requestAt) : buildGuardedMarketJudgment(archive.snapshot, requestAt)
        const issuedAt = now().toISOString()
        if (reviewSessionDate(asset, issuedAt) !== session) throw new TypeSafeError('session', '记录期间交易日期变化，未合并不同窗口，请重试。')
        input.state.requestAt = issuedAt
        const row: ForwardPublication = { schemaVersion: 1, protocol, id: randomUUID(), asset, issuedAt,
          policy: { ...JEV_DECISION_POLICY, combinedProtocol: combined.protocol, combinedDecisionPolicy: protocol !== 'market-forward-v2' ? 'guarded-price-evidence-v3' : 'guarded-price-evidence-v2' },
          basis: { snapshotId: archive.snapshot.id, inputHash: archive.snapshot.analysisInput!.hash, capturedAt: archive.input.asOf,
            strategyId: strategy, strategyVersion: archive.input.strategyVersion, provider: archive.snapshot.sourceHealth.find(source => source.id === 'daily-bars')?.provider ?? null },
          input, inputHash: hashJevInput(input), rules: Object.fromEntries(JEV_HORIZONS.map(h => [h, direction(archive.snapshot.trend?.[h].direction ?? 'insufficient')])) as ForwardPublication['rules'],
          combined, recordHash: '' }
        row.recordHash = forwardRecordHash(row)
        publication = await store.savePublication(asset, session, row)
      }
      validatePublication(publication, asset, session, now(), protocol)
      const archive = await market.archive(publication.basis.snapshotId)
      if (!verifiedArchive(archive, publication)) throw new TypeSafeError('basis', '冻结的新版验证缺少可核验原始档案，未请求模型。')
      const existing = await store.candidate(asset, session)
      if (existing) { validateCandidate(existing, publication, now()); errors.delete(asset); retryAfter.delete(asset); return publication }
      const settings = await credentials.settings()
      if (!allowModel || !settings.configured) { errors.delete(asset); retryAfter.delete(asset); return publication }
      const config = await credentials.config()
      if (!config.apiKey) { errors.delete(asset); retryAfter.delete(asset); return publication }
      const requestedAt = now().toISOString()
      if (reviewSessionDate(asset, requestedAt) !== session) throw new TypeSafeError('session', '模型请求跨越交易日期，未合并不同窗口，请重试。')
      const raw = await client.evaluate(config.apiKey, publication.input.state, publication.input.questions)
      const issuedAt = now().toISOString()
      if (reviewSessionDate(asset, issuedAt) !== session) throw new TypeSafeError('session', '模型请求跨越交易日期，结果未写入原窗口，请重试。')
      if (!validResult(raw)) throw new TypeSafeError('response', '新版验证模型返回格式无效，原始发布已保留。')
      const candidate: ForwardCandidate = { schemaVersion: 1, protocol, publicationId: publication.id, requestedAt, issuedAt, inputHash: publication.inputHash,
        raw: structuredClone(raw), decisions: Object.fromEntries(JEV_HORIZONS.map(h => [h, guardedJevDecision(raw, h, publication!.input.history[h])])) as ForwardCandidate['decisions'], recordHash: '' }
      candidate.recordHash = forwardRecordHash(candidate)
      validateCandidate(candidate, publication, now())
      const saved = await store.saveCandidate(asset, session, candidate)
      validateCandidate(saved, publication, now())
      errors.delete(asset); retryAfter.delete(asset)
      return publication
    })().catch(error => {
      const message = safeMessage(error)
      errors.set(asset, message); retryAfter.set(asset, { session: reviewSessionDate(asset, now().toISOString()), until: now().getTime() + 3_600_000 })
      throw new TypeSafeError('forward-validation', message)
    }).finally(() => pending.delete(asset))
    pending.set(asset, { allowModel, task })
    return task
  }

  return {
    collect: (asset: MarketMonitorAsset, refresh = true) => collect(asset, refresh, true),
    async automatic(asset: MarketMonitorAsset) {
      const at = now(), session = reviewSessionDate(asset, at.toISOString()), retry = retryAfter.get(asset)
      if (retry?.session === session && retry.until > at.getTime()) return
      const settings = await credentials.settings()
      const key = `${session}:${settings.configured}:${settings.automatic}`
      if (automaticDone.get(asset) === key) return
      await collect(asset, false, settings.configured && settings.automatic)
      automaticDone.set(asset, key)
    },
    async report(asset: MarketMonitorAsset): Promise<ForwardReport> {
      const at = now(), settings = await credentials.settings(), listing = await store.sessions(asset)
      const rows: ForwardRow[] = []
      const seriesCache = new Map<string, Awaited<ReturnType<MarketMonitorStore['latestSeries']>>>()
      let invalidRecords = 0, latest: ForwardReport['latest'] = null
      for (const session of listing.sessions.filter(value => value <= reviewSessionDate(asset, at.toISOString()) && Date.parse(value) >= at.getTime() - 91 * 86_400_000)) {
        // Never fall back to an older apparently-current direction when the
        // newest publication is damaged or its original basis is unavailable.
        latest = null
        try {
          const publication = await store.publication(asset, session)
          if (!publication) continue
          validatePublication(publication, asset, session, at, protocol)
          let candidate: ForwardCandidate | null = null
          try {
            candidate = await store.candidate(asset, session)
            if (candidate) validateCandidate(candidate, publication, at)
          } catch { candidate = null; invalidRecords++ }
          const archive = await market.archive(publication.basis.snapshotId).catch(() => null)
          const verified = verifiedArchive(archive, publication)
          if (!verified) invalidRecords++
          if (!seriesCache.has(publication.basis.strategyId)) seriesCache.set(publication.basis.strategyId, await market.latestSeries(asset, publication.basis.strategyId))
          const series = seriesCache.get(publication.basis.strategyId)
          const providerChanged = Boolean(series && publication.basis.provider !== (series.dailyMeta.sourceId ?? series.dailyMeta.provider))
          const outcomes = reviewOutcomes({ id: publication.id, kind: 'rules', snapshotId: publication.basis.snapshotId, issuedAt: publication.issuedAt,
            sessionDate: session, strategyVersion: publication.basis.strategyVersion, archiveStatus: verified ? 'verified' : 'invalid', original: archive?.snapshot ?? null,
            narration: null, originalProvider: publication.basis.provider, outcomeProvider: series?.dailyMeta.sourceId ?? series?.dailyMeta.provider ?? null,
            providerChanged, path: [], outcomes: [] }, asset, series?.daily ?? [], at).map(outcome => {
            const h = outcome.trendHorizon, answer = candidate?.raw.answers[h]
            const actual = outcome.status === 'complete' ? returnChoice(outcome.entry!, outcome.close!) : null
            const frequency = publication.input.history[h].probabilities
            const choices: Record<ForwardMethod, ReturnChoice | null> = {
              rules: publication.rules[h], jev: candidate?.decisions[h].choice ?? null,
              combined: publication.combined.horizons[h].decision === 'directional' ? direction(publication.combined.horizons[h].direction) : null,
              frequency: frequencyChoice(frequency), alwaysUp: 'up',
            }
            const brier = (probabilities: Record<ReturnChoice, number> | null) => actual && probabilities ? (['up', 'flat', 'down'] as const).reduce((sum, key) => sum + (probabilities[key] - (key === actual ? 1 : 0)) ** 2, 0) : null
            const jevProbabilities = validForwardAnswer(answer, ['up', 'flat', 'down']) ? answer.probabilities as Record<ReturnChoice, number> : null
            return { horizon: h, outcome, actual, choices,
              selectedProbabilities: { jev: choices.jev && jevProbabilities ? jevProbabilities[choices.jev] : null,
                frequency: choices.frequency && frequency ? frequency[choices.frequency] : null },
              correct: Object.fromEntries(methods.map(method => [method, actual && choices[method] ? actual === choices[method] : null])) as Record<ForwardMethod, boolean | null>,
              brier: { jev: brier(jevProbabilities), frequency: brier(frequency) } }
          })
          rows.push({ id: publication.id, issuedAt: publication.issuedAt, snapshotId: publication.basis.snapshotId, candidateAvailable: Boolean(candidate), providerChanged, cohort: forwardCohort(publication), outcomes })
          latest = verified ? { publication, candidate } : null
        } catch { invalidRecords++ }
      }
      const { strategyId } = await deps.monitor.settings()
      const strategyVersion = deps.monitor.strategies?.().find(strategy => strategy.id === strategyId)?.version
        ?? (() => { const registry = createMarketMonitorStrategyRegistry(); return registry.has(strategyId) ? registry.get(strategyId).manifest.version : 0 })()
      const currentCohort = forwardCohort({ protocol, basis: { strategyId, strategyVersion },
        policy: { ...JEV_DECISION_POLICY, combinedProtocol: protocol !== 'market-forward-v2' ? 'evidence-summary-v3' : 'evidence-summary-v2', combinedDecisionPolicy: protocol !== 'market-forward-v2' ? 'guarded-price-evidence-v3' : 'guarded-price-evidence-v2' } })
      return { protocol, asset, generatedAt: at.toISOString(), configured: settings.configured, automatic: settings.automatic,
        invalidRecords, historyTruncated: listing.truncated, lastError: errors.get(asset) ?? null, latest, rows, summaries: summarizeForwardValidation(rows), validation: analyzeForwardValidation(rows, currentCohort) }
    },
  }
}
export type ForecastValidationService = ReturnType<typeof createForecastValidation>
