import { randomUUID } from 'node:crypto'
import { createTypeSafeClient, TypeSafeError } from './typesafe-client.js'
import { createTypeSafeStore } from './typesafe-store.js'
import type { TypeSafeService } from './typesafe-service.js'
import { createMarketMonitorStore, type MarketMonitorStore } from './store.js'
import { buildMarketJudgment } from './judgment.js'
import { buildChallengerInput, returnChoice } from './forecast-history.js'
import { hashJevInput } from './typesafe-input.js'
import { createForecastExperimentStore, recordHash } from './forecast-experiment-store.js'
import { EXPERIMENT_PROTOCOL, type ExperimentCandidate, type ExperimentPublication, type ExperimentReport, type ExperimentRow, type ReturnChoice, type ExperimentMethod } from './forecast-experiment-types.js'
import { JEV_HORIZONS } from './typesafe-types.js'
import { reviewOutcomes, reviewSessionDate } from './review.js'
import { firstPerOutcomeWindow } from './review-cohort.js'
import type { MarketMonitorAsset } from './types.js'

const methods: ExperimentMethod[] = ['original', 'challenger', 'rules', 'combined', 'frequency', 'alwaysUp']
const direction = (value: string): ReturnChoice | null => value === 'bullish' ? 'up' : value === 'bearish' ? 'down' : null
const distributionChoice = (probabilities: Record<string, number> | null): ReturnChoice | null => {
  if (!probabilities) return null
  const choices = (['up', 'flat', 'down'] as const).filter(k => probabilities[k] === Math.max(...Object.values(probabilities)))
  return choices.length === 1 ? choices[0]! : null
}
const safeMessage = (error: unknown) => error instanceof TypeSafeError ? error.message : '对照实验暂不可用，已有预测与行情不受影响。'

export function summarizeExperiment(rows: ExperimentRow[]): ExperimentReport['summaries'] {
  return JEV_HORIZONS.map(horizon => {
    const all = rows.map(row => ({ issuedAt: row.issuedAt, ...row.outcomes.find(o => o.horizon === horizon)! }))
    const complete = all.filter(v => v.outcome.status === 'complete')
    const unique = firstPerOutcomeWindow(complete, v => ({ issuedAt: v.issuedAt, ...v.outcome }))
    const paired = unique.filter(v => v.correct.original !== null && v.correct.challenger !== null)
    const mean = (key: 'original' | 'challenger' | 'frequency') => paired.length && paired.every(v => v.brier[key] !== null) ? paired.reduce((sum, v) => sum + v.brier[key]!, 0) / paired.length : null
    return { horizon, total: all.length, complete: complete.length, uniqueWindows: unique.length, duplicateWindows: complete.length - unique.length,
      pending: all.filter(v => v.outcome.status === 'pending').length, excluded: all.filter(v => v.outcome.status === 'unverified' || v.outcome.status === 'missing-data').length,
      methods: Object.fromEntries(methods.map(method => [method, { scored: unique.filter(v => v.correct[method] !== null).length, correct: unique.filter(v => v.correct[method] === true).length }])) as ExperimentReport['summaries'][number]['methods'],
      paired: { count: paired.length, originalCorrect: paired.filter(v => v.correct.original).length, challengerCorrect: paired.filter(v => v.correct.challenger).length,
        originalBrier: mean('original'), challengerBrier: mean('challenger'), frequencyBrier: mean('frequency') } }
  })
}

export function createForecastExperiment(deps: { baseline: Pick<TypeSafeService, 'generate' | 'report' | 'settings'>;
  market?: MarketMonitorStore; store?: ReturnType<typeof createForecastExperimentStore>; credentials?: Pick<ReturnType<typeof createTypeSafeStore>, 'config'>;
  client?: ReturnType<typeof createTypeSafeClient>; now?: () => Date }) {
  const market = deps.market ?? createMarketMonitorStore(), store = deps.store ?? createForecastExperimentStore()
  const credentials = deps.credentials ?? createTypeSafeStore(), client = deps.client ?? createTypeSafeClient(), now = deps.now ?? (() => new Date())
  const pending = new Map<MarketMonitorAsset, Promise<ExperimentPublication>>()
  const errors = new Map<MarketMonitorAsset, string>(), retryAfter = new Map<MarketMonitorAsset, number>()
  const collect = (asset: MarketMonitorAsset, refresh = true): Promise<ExperimentPublication> => {
    const running = pending.get(asset)
    if (running) return running
    const task = (async () => {
      const session = reviewSessionDate(asset, now().toISOString())
      let publication = await store.publication(asset, session)
      const priorCandidate = await store.candidate(asset, session)
      if (publication && priorCandidate) { errors.delete(asset); return publication }
      const original = publication?.original ?? await deps.baseline.generate(asset, refresh)
      if (recordHash(original) !== original.recordHash || original.inputHash !== hashJevInput({ state: original.state, questions: original.questions })
        || original.asset !== asset || reviewSessionDate(asset, original.issuedAt) !== session) throw new TypeSafeError('basis', '原版预测与今日交易日期不匹配，未建立对照。')
      const archive = await market.archive(original.basis.snapshotId)
      if (!archive || archive.snapshot.asset !== asset || archive.snapshot.analysisInput?.hash !== original.basis.inputHash
        || archive.input.strategyVersion !== original.basis.strategyVersion || archive.input.strategyId !== original.basis.strategyId
        || archive.input.asOf !== original.basis.capturedAt || Date.parse(archive.input.asOf) > Date.parse(original.issuedAt)) throw new TypeSafeError('basis', '原版行情档案无法验证，未建立对照。')
      const input = buildChallengerInput(archive, now())
      if (!publication) {
        const baseline = await deps.baseline.report(asset)
        const issuedAt = now().toISOString()
        if (reviewSessionDate(asset, issuedAt) !== session) throw new TypeSafeError('session', '记录期间交易日期变化，请重试。')
        const combined = buildMarketJudgment(archive.snapshot, new Date(issuedAt), { ...baseline, rows: baseline.rows.filter(row => row.forecast.id === original.id) })
        const row: ExperimentPublication = { protocol: EXPERIMENT_PROTOCOL, id: randomUUID(), asset, issuedAt, recordHash: '', original, combined }
        row.recordHash = recordHash(row)
        publication = await store.savePublication(asset, session, row)
      }
      const config = await credentials.config()
      const result = await client.evaluate(config.apiKey, input.state, input.questions)
      const issuedAt = now().toISOString()
      if (reviewSessionDate(asset, issuedAt) !== session) throw new TypeSafeError('session', '模型请求跨越交易日期，未将不同窗口合并，请重试。')
      const candidate: ExperimentCandidate = { protocol: EXPERIMENT_PROTOCOL, publicationId: publication.id, issuedAt, recordHash: '', inputHash: hashJevInput({ state: input.state, questions: input.questions }),
        state: input.state, questions: input.questions, result, history: input.history }
      candidate.recordHash = recordHash(candidate)
      await store.saveCandidate(asset, session, candidate)
      errors.delete(asset); retryAfter.delete(asset)
      return publication
    })().catch(error => { errors.set(asset, safeMessage(error)); retryAfter.set(asset, now().getTime() + 3600_000); throw new TypeSafeError('experiment', safeMessage(error)) }).finally(() => pending.delete(asset))
    pending.set(asset, task)
    return task
  }
  return {
    collect,
    async automatic(asset: MarketMonitorAsset) {
      const settings = await deps.baseline.settings()
      if (settings.configured && settings.automatic && (retryAfter.get(asset) ?? 0) <= now().getTime()) await collect(asset, false)
    },
    async report(asset: MarketMonitorAsset): Promise<ExperimentReport> {
      const at = now(), settings = await deps.baseline.settings(), listing = await store.sessions(asset)
      const rows: ExperimentRow[] = []
      let latest: ExperimentReport['latest'] = null, invalidRecords = 0
      for (const session of listing.sessions.filter(s => s <= reviewSessionDate(asset, at.toISOString()) && Date.parse(s) >= at.getTime() - 91 * 86400000)) {
        try {
          const publication = await store.publication(asset, session)
          if (!publication) continue
          const original = publication.original
          if (publication.protocol !== EXPERIMENT_PROTOCOL || publication.asset !== asset || reviewSessionDate(asset, publication.issuedAt) !== session
            || Date.parse(publication.issuedAt) > at.getTime() || original.asset !== asset || reviewSessionDate(asset, original.issuedAt) !== session
            || recordHash(original) !== original.recordHash || original.inputHash !== hashJevInput({ state: original.state, questions: original.questions })) throw new Error('identity')
          let candidate: ExperimentCandidate | null = null
          try {
            candidate = await store.candidate(asset, session)
            if (candidate && (candidate.protocol !== EXPERIMENT_PROTOCOL || candidate.publicationId !== publication.id || candidate.result.model !== original.model
              || Date.parse(candidate.issuedAt) < Date.parse(publication.issuedAt) || Date.parse(candidate.issuedAt) > at.getTime() || reviewSessionDate(asset, candidate.issuedAt) !== session
              || candidate.inputHash !== hashJevInput({ state: candidate.state, questions: candidate.questions }))) throw new Error('candidate')
          } catch { candidate = null; invalidRecords++ }
          const archive = await market.archive(original.basis.snapshotId).catch(() => null)
          const verified = archive && archive.snapshot.asset === asset && archive.snapshot.analysisInput?.hash === original.basis.inputHash
            && archive.input.strategyId === original.basis.strategyId && archive.input.strategyVersion === original.basis.strategyVersion && archive.input.asOf === original.basis.capturedAt
            && Date.parse(archive.input.asOf) <= Date.parse(original.issuedAt) && publication.combined.snapshotId === original.basis.snapshotId
          const series = await market.latestSeries(asset, original.basis.strategyId)
          const providerChanged = Boolean(archive && series && archive.snapshot.sourceHealth.find(s => s.id === 'daily-bars')?.provider !== (series.dailyMeta.sourceId ?? series.dailyMeta.provider))
          const outcomes = reviewOutcomes({ id: publication.id, kind: 'rules', snapshotId: original.basis.snapshotId, issuedAt: publication.issuedAt, sessionDate: session,
            strategyVersion: original.basis.strategyVersion, archiveStatus: verified ? 'verified' : 'invalid', original: archive?.snapshot ?? null,
            narration: null, originalProvider: null, outcomeProvider: null, providerChanged, path: [], outcomes: [] }, asset, series?.daily ?? [], at).map(outcome => {
            const h = outcome.trendHorizon, originalAnswer = original.horizons[h], candidateAnswer = candidate?.result.answers[h]
            const actual = outcome.status === 'complete' ? returnChoice(outcome.entry!, outcome.close!) : null
            const frequencies = candidate?.history[h].probabilities ?? null
            const choices: ExperimentRow['outcomes'][number]['choices'] = {
              original: originalAnswer.adequacy.choice === 'adequate' ? originalAnswer.answer.choice as ReturnChoice : null,
              challenger: candidateAnswer && candidate?.result.answers[`${h}Evidence`]?.choice === 'adequate' ? candidateAnswer.choice as ReturnChoice : null,
              rules: direction(originalAnswer.baseline), combined: direction(publication.combined.horizons[h].direction), frequency: distributionChoice(frequencies), alwaysUp: 'up' }
            const brier = (probabilities: Record<string, number> | null | undefined) => actual && probabilities ? ['up', 'flat', 'down'].reduce((sum, key) => sum + (probabilities[key]! - (key === actual ? 1 : 0)) ** 2, 0) : null
            return { horizon: h, outcome, actual, choices, correct: Object.fromEntries(methods.map(m => [m, actual && choices[m] ? actual === choices[m] : null])) as Record<ExperimentMethod, boolean | null>,
              brier: { original: brier(originalAnswer.answer.probabilities), challenger: brier(candidateAnswer?.probabilities), frequency: brier(frequencies) } }
          })
          rows.push({ id: publication.id, issuedAt: publication.issuedAt, snapshotId: original.basis.snapshotId, candidateAvailable: Boolean(candidate), providerChanged, outcomes })
          latest = { publication, candidate }
        } catch { invalidRecords++ }
      }
      return { protocol: EXPERIMENT_PROTOCOL, asset, generatedAt: at.toISOString(), configured: settings.configured, automatic: settings.automatic,
        historyTruncated: listing.truncated, invalidRecords, lastError: errors.get(asset) ?? null, latest, rows, summaries: summarizeExperiment(rows) }
    },
  }
}
export type ForecastExperimentService = ReturnType<typeof createForecastExperiment>
