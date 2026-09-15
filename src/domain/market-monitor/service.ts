import { randomUUID } from 'node:crypto'
import type { EquityClientLike } from '../market-data/client/types.js'
import type { BarMeta, BarService, BarsResult, OhlcvBar } from '../market-data/bars/index.js'
import type { INewsProvider } from '../news/types.js'
import type { ReferenceDataService } from '../market-data/reference/types.js'
import { evaluateSnapshots } from './analysis.js'
import { createDailyMarketBrief } from './daily-brief.js'
import { HEALTH_RECEIPT_LIMIT, summarizeMonitorHealth } from './health.js'
import {
  createDefaultMarketContextProviderRegistry,
  type MarketContextProviderRegistry,
  type MarketMonitorFetch,
} from './context.js'
import { createMarketMonitorStore, type MarketMonitorStore } from './store.js'
import {
  createMarketMonitorStrategyRegistry,
  type MarketMonitorStrategyRegistry,
} from './strategy.js'
import {
  MARKET_MONITOR_ASSET_CONFIG,
  MARKET_MONITOR_ASSETS,
  MARKET_DAILY_NARRATION_ISSUE_ID,
  type MarketAiNarration,
  type MarketContext,
  type MarketContextProviderManifest,
  type MarketMonitorAlert,
  type MarketMonitorAsset,
  type MarketMonitorEvaluation,
  type MarketMonitorHealthReport,
  type MarketMonitorReceipt,
  type MarketMonitorScanResult,
  type MarketMonitorSettings,
  type MarketMonitorSnapshot,
  type MarketMonitorStrategyManifest,
  type MarketMonitorTrigger,
  type SourceHealth,
} from './types.js'

export interface MarketMonitorServiceDeps {
  barService: BarService
  equityClient: EquityClientLike
  reference: ReferenceDataService
  newsProvider?: INewsProvider
  store?: MarketMonitorStore
  fetcher?: MarketMonitorFetch
  strategyRegistry?: MarketMonitorStrategyRegistry
  contextProviderRegistry?: MarketContextProviderRegistry
  now?: () => Date
}

export interface MarketMonitorService {
  settings(): Promise<MarketMonitorSettings>
  saveSettings(settings: MarketMonitorSettings): Promise<void>
  scan(asset: MarketMonitorAsset, trigger: MarketMonitorTrigger): Promise<MarketMonitorScanResult>
  isScanning(asset: MarketMonitorAsset): boolean
  snapshots(asset?: MarketMonitorAsset, limit?: number, strategyId?: string): Promise<MarketMonitorSnapshot[]>
  alerts(asset?: MarketMonitorAsset, limit?: number): Promise<MarketMonitorAlert[]>
  receipts(asset?: MarketMonitorAsset, limit?: number): Promise<MarketMonitorReceipt[]>
  evaluation(asset: MarketMonitorAsset): Promise<MarketMonitorEvaluation>
  health(asset: MarketMonitorAsset, hours?: 24 | 72): Promise<MarketMonitorHealthReport>
  strategies(): MarketMonitorStrategyManifest[]
  contextProviders(): MarketContextProviderManifest[]
  dailyNarrationInput(assets?: MarketMonitorAsset[]): Promise<MarketNarrationInput>
  publishNarration(input: MarketNarrationPublishInput, provenance: MarketNarrationProvenance): Promise<{ stored: boolean; narration: MarketAiNarration }>
  narrations(asset?: MarketMonitorAsset, limit?: number): Promise<MarketAiNarration[]>
}

export interface MarketNarrationInput {
  generatedAt: string
  strategyId: string
  assets: Array<{
    asset: MarketMonitorAsset
    status: 'ready' | 'already-published' | 'failed'
    periodKey?: string
    snapshot?: Omit<MarketMonitorSnapshot, 'chart' | 'aiNarration'>
    existingNarration?: MarketAiNarration
    error?: string
  }>
}

export interface MarketNarrationPublishInput {
  asset: MarketMonitorAsset
  strategyId: string
  periodKey: string
  headline: string
  summary: string
  shortTerm: string
  mediumTerm: string
  longTerm: string
  evidence: string[]
  risks: string[]
  watchFor: string[]
}

export interface MarketNarrationProvenance {
  workspaceId: string
  runId: string
  issueId: string
  agent: string
  model?: string
  effort?: string
}

function compactBars(bars: OhlcvBar[], max: number): OhlcvBar[] {
  return bars.slice(-max).map(({ date, open, high, low, close, volume }) => ({ date, open, high, low, close, volume }))
}

function retainPreviousContext(current: MarketContext, previous: MarketContext | undefined): { context: MarketContext; retained: boolean } {
  if (!previous) return { context: current, retained: false }
  const merged: MarketContext = { ...previous, ...current }
  let retained = false
  const numeric = [
    'fundingRate', 'openInterest', 'annualizedBasisPercent', 'optionOpenInterest',
    'putCallOpenInterestRatio', 'marketCap', 'trailingPe', 'forwardPe',
    'analystTargetMean', 'shortPercentFloat',
  ] as const
  for (const key of numeric) {
    if (current[key] == null && previous[key] != null) {
      merged[key] = previous[key]
      retained = true
    }
  }
  if (current.nextEarningsAt == null && previous.nextEarningsAt != null) {
    merged.nextEarningsAt = previous.nextEarningsAt
    retained = true
  }
  if (!current.recentNews?.length && previous.recentNews?.length) {
    merged.recentNews = previous.recentNews
    retained = true
  }
  if (!current.recentFilings?.length && previous.recentFilings?.length) {
    merged.recentFilings = previous.recentFilings
    retained = true
  }
  return { context: merged, retained }
}

interface BarFallback {
  from: string
  to: string
  reason: string
}

async function loadBars(barService: BarService, asset: MarketMonitorAsset, interval: '1d' | '1h', count: number): Promise<{ result: BarsResult; fallback: BarFallback | null }> {
  const config = MARKET_MONITOR_ASSET_CONFIG[asset]
  if (config.preferredBarId) {
    try {
      return { result: await barService.getBars({ barId: config.preferredBarId, assetClass: config.assetClass }, { interval, count }), fallback: null }
    } catch (preferredError) {
      const result = await barService.getBars({ barId: config.barId, assetClass: config.assetClass }, { interval, count })
      return {
        result,
        fallback: {
          from: config.preferredBarId.split('|')[0] ?? config.preferredBarId,
          to: result.meta.sourceId ?? result.meta.provider ?? config.barId.split('|')[0] ?? 'fallback',
          reason: preferredError instanceof Error ? preferredError.message : String(preferredError),
        },
      }
    }
  }
  try {
    return { result: await barService.getBars({ symbol: config.symbol, assetClass: config.assetClass }, { interval, count }), fallback: null }
  } catch (primaryError) {
    try {
      const result = await barService.getBars({ barId: config.barId, assetClass: config.assetClass }, { interval, count })
      return {
        result,
        fallback: {
          from: 'configured provider',
          to: result.meta.sourceId ?? result.meta.provider ?? config.barId.split('|')[0] ?? 'fallback',
          reason: primaryError instanceof Error ? primaryError.message : String(primaryError),
        },
      }
    } catch {
      throw primaryError
    }
  }
}

export function createMarketMonitorService(deps: MarketMonitorServiceDeps): MarketMonitorService {
  const store = deps.store ?? createMarketMonitorStore()
  const now = deps.now ?? (() => new Date())
  const inFlight = new Map<MarketMonitorAsset, Promise<MarketMonitorScanResult>>()
  const narrationWrites = new Map<string, Promise<{ stored: boolean; narration: MarketAiNarration }>>()
  const strategyRegistry = deps.strategyRegistry ?? createMarketMonitorStrategyRegistry()
  const contextProviderRegistry = deps.contextProviderRegistry ?? createDefaultMarketContextProviderRegistry({
    equityClient: deps.equityClient,
    reference: deps.reference,
    ...(deps.newsProvider ? { newsProvider: deps.newsProvider } : {}),
    ...(deps.fetcher ? { fetcher: deps.fetcher } : {}),
  })
  const loadSettings = async (): Promise<MarketMonitorSettings> => {
    const settings = await store.settings()
    return strategyRegistry.has(settings.strategyId)
      ? settings
      : { ...settings, strategyId: strategyRegistry.list()[0]!.id }
  }
  return {
    settings: loadSettings,
    async saveSettings(settings) {
      strategyRegistry.get(settings.strategyId)
      await store.saveSettings(settings)
    },
    strategies: () => strategyRegistry.list(),
    contextProviders: () => contextProviderRegistry.list(),
    narrations: (asset, limit) => store.narrations(asset, limit),
    isScanning: (asset) => inFlight.has(asset),
    async snapshots(asset, limit, strategyId) {
      if (strategyId) strategyRegistry.get(strategyId)
      const boundedLimit = Math.max(1, Math.min(1000, limit ?? 100))
      const candidates = await store.snapshots(asset, strategyId ? 1000 : boundedLimit)
      const rows = candidates
        .filter((row) => !strategyId || row.strategyId === strategyId)
        .slice(-boundedLimit)
      const latestBySeries = new Map<string, number>()
      rows.forEach((row, index) => latestBySeries.set(`${row.asset}:${row.strategyId}`, index))
      for (const index of latestBySeries.values()) {
        const row = rows[index]!
        const chart = await store.latestSeries(row.asset, row.strategyId)
        if (chart) rows[index] = { ...row, chart }
      }
      const narrations = await store.narrations(asset, 1000)
      const byPeriod = new Map(narrations.map((row) => [`${row.asset}:${row.strategyId}:${row.periodKey}`, row]))
      rows.forEach((row, index) => {
        const narration = row.dailyBrief && byPeriod.get(`${row.asset}:${row.strategyId}:${row.dailyBrief.periodKey}`)
        if (narration) rows[index] = { ...row, aiNarration: narration }
      })
      return rows
    },
    async dailyNarrationInput(assets = [...MARKET_MONITOR_ASSETS]) {
      const settings = await loadSettings()
      const narrations = await store.narrations(undefined, 1000)
      const rows: MarketNarrationInput['assets'] = []
      for (const asset of assets) {
        try {
          const result = await this.scan(asset, 'scheduled')
          const snapshot = result.snapshot
          const periodKey = snapshot.dailyBrief?.periodKey
          if (!periodKey) throw new Error('Daily deterministic brief is unavailable')
          const existingNarration = narrations.find((row) => row.asset === asset && row.strategyId === snapshot.strategyId && row.periodKey === periodKey)
          const { chart: _chart, aiNarration: _narration, ...compact } = snapshot
          rows.push({ asset, status: existingNarration ? 'already-published' : 'ready', periodKey, snapshot: compact, ...(existingNarration ? { existingNarration } : {}) })
        } catch (error) {
          rows.push({ asset, status: 'failed', error: error instanceof Error ? error.message : String(error) })
        }
      }
      return { generatedAt: now().toISOString(), strategyId: settings.strategyId, assets: rows }
    },
    publishNarration(input, provenance) {
      const key = `${input.asset}:${input.strategyId}:${input.periodKey}`
      const pending = narrationWrites.get(key)
      if (pending) return pending
      const task = (async () => {
        if (provenance.agent !== 'codex' || provenance.issueId !== MARKET_DAILY_NARRATION_ISSUE_ID) throw new Error('Daily narration must be published by the authorized Codex Issue')
        const rows = (await store.snapshots(input.asset, 1000)).filter((row) => row.strategyId === input.strategyId)
        const latest = rows.at(-1)
        if (!latest || latest.dailyBrief?.periodKey !== input.periodKey) throw new Error('The narration period does not match the current deterministic daily brief')
        const existing = (await store.narrations(input.asset, 1000)).find((row) => row.strategyId === input.strategyId && row.periodKey === input.periodKey)
        if (existing) return { stored: false, narration: existing }
        const clean = (value: string) => value.trim()
        const cleanList = (values: string[]) => values.map(clean).filter(Boolean).slice(0, 8)
        const narration: MarketAiNarration = {
          id: randomUUID(), asset: input.asset, strategyId: input.strategyId, periodKey: input.periodKey,
          promptVersion: 'codex-daily-v1', generatedAt: now().toISOString(), language: 'zh-CN', agent: 'codex',
          ...(provenance.model ? { model: provenance.model } : {}),
          ...(provenance.effort ? { effort: provenance.effort } : {}),
          headline: clean(input.headline), summary: clean(input.summary), shortTerm: clean(input.shortTerm),
          mediumTerm: clean(input.mediumTerm), longTerm: clean(input.longTerm), evidence: cleanList(input.evidence),
          risks: cleanList(input.risks), watchFor: cleanList(input.watchFor),
          provenance: { workspaceId: provenance.workspaceId, runId: provenance.runId, issueId: provenance.issueId },
        }
        await store.appendNarration(narration)
        return { stored: true, narration }
      })().finally(() => { narrationWrites.delete(key) })
      narrationWrites.set(key, task)
      return task
    },
    alerts: (asset, limit) => store.alerts(asset, limit),
    receipts: (asset, limit) => store.receipts(asset, limit),
    async health(asset, hours = 24) {
      if (hours !== 24 && hours !== 72) throw new Error('Health window must be 24 or 72 hours')
      return summarizeMonitorHealth(asset, await store.receipts(asset, HEALTH_RECEIPT_LIMIT + 1), hours, now())
    },
    async evaluation(asset) {
      const settings = await loadSettings()
      const rows = (await store.snapshots(asset, 1000)).filter((row) => row.strategyId === settings.strategyId)
      return evaluateSnapshots(asset, rows)
    },
    scan(asset, trigger) {
      // One writer per asset. Manual, scheduled and multiple browser requests
      // share the active operation and its original trigger/receipt.
      const pending = inFlight.get(asset)
      if (pending) return pending
      const task = (async () => {
        const requestedAt = now().toISOString()
        const started = performance.now()
        let strategyId: string | undefined
        const receiptBase = { id: randomUUID(), asset, requestedAt, trigger } as const
        try {
          const settings = await loadSettings()
          const strategy = strategyRegistry.get(settings.strategyId)
          strategyId = strategy.manifest.id
          const daily = await loadBars(deps.barService, asset, '1d', 400)
          let intraday: { result: BarsResult; fallback: BarFallback | null } | null = null
          let intradayError: unknown
          try { intraday = await loadBars(deps.barService, asset, '1h', 180) } catch (error) { intradayError = error }
          const analysis = strategy.analyze({
            asset,
            dailyBars: daily.result.bars, intradayBars: intraday?.result.bars ?? [],
            abnormalMovePercent: settings.abnormalMovePercent,
            abnormalVolumeRatio: settings.abnormalVolumeRatio,
          })
          const sourceHealth: SourceHealth[] = [
            healthFromMeta('daily-bars', 'Daily OHLCV', daily.result.meta, daily.fallback),
            intraday
              ? healthFromMeta('intraday-bars', 'Hourly OHLCV', intraday.result.meta, intraday.fallback)
              : { id: 'intraday-bars', label: 'Hourly OHLCV', status: 'unavailable', provider: 'OpenAlice BarService', asOf: null, detail: intradayError instanceof Error ? intradayError.message : 'Hourly source unavailable.' },
          ]
          const previous = (await store.snapshots(asset, 1000)).filter((row) => row.strategyId === strategy.manifest.id).at(-1)
          const previousCapturedAt = previous?.capturedAt ?? 'an earlier scan'
          const providers = contextProviderRegistry.forAsset(asset)
          const contextResults = await Promise.all(providers.map(async (provider) => {
            try {
              return await provider.load({ asset, at: new Date(requestedAt) })
            } catch (error) {
              return {
                context: {},
                health: [{
                  id: `context-provider:${provider.manifest.id}`,
                  label: provider.manifest.label,
                  status: 'unavailable' as const,
                  provider: provider.manifest.id,
                  asOf: null,
                  detail: error instanceof Error ? error.message : String(error),
                }],
              }
            }
          }))
          const contextResult = {
            context: Object.assign({}, ...contextResults.map((result) => result.context)) as MarketContext,
            health: contextResults.flatMap((result) => result.health),
          }
          const fallback = contextResult.health.some((source) => source.status !== 'ok')
            ? retainPreviousContext(contextResult.context, previous?.context)
            : { context: contextResult.context, retained: false }
          const context: MarketContext = fallback.context
          sourceHealth.push(...contextResult.health.map((source) => fallback.retained && source.status !== 'ok'
            ? { ...source, detail: `${source.detail} Last valid fields retained from ${previousCapturedAt}.` }
            : source))
          const enrichedAnalysis = {
            ...analysis,
            dailyBrief: createDailyMarketBrief({
              metrics: analysis.metrics,
              trend: analysis.trend,
              wyckoff: analysis.wyckoff,
              sourceHealth,
            }),
          }
          const fingerprint = strategy.fingerprint({ asset, ...enrichedAnalysis, context, sourceHealth })
          const snapshot: MarketMonitorSnapshot = {
            id: randomUUID(), asset, capturedAt: requestedAt, trigger,
            strategyId: strategy.manifest.id, fingerprint, ...enrichedAnalysis, context, sourceHealth,
            chart: {
              daily: compactBars(daily.result.bars, 400), intraday: compactBars(intraday?.result.bars ?? [], 180),
              dailyMeta: daily.result.meta, intradayMeta: intraday?.result.meta ?? null,
            },
          }
          const stored = previous?.fingerprint !== fingerprint
          await store.saveLatestSeries(asset, snapshot.chart, snapshot.strategyId)
          if (stored) {
            await store.appendSnapshot({ ...snapshot, chart: { ...snapshot.chart, daily: [], intraday: [] } })
          }
          const alert = stored ? await maybeAlert(store, snapshot, previous, settings) : null
          const receipt: MarketMonitorReceipt = {
            ...receiptBase, completedAt: now().toISOString(), strategyId,
            durationMs: Math.max(0, Math.round(performance.now() - started)),
            sourceHealth: sourceHealth.map(({ id, label, provider, status, asOf }) => ({ id, label, provider, status, asOf })),
            outcome: stored ? 'stored' : 'duplicate', snapshotId: stored ? snapshot.id : previous?.id,
          }
          await store.appendReceipt(receipt)
          return { snapshot, stored, alert, receipt }
        } catch (error) {
          const receipt: MarketMonitorReceipt = {
            ...receiptBase, completedAt: now().toISOString(), strategyId,
            durationMs: Math.max(0, Math.round(performance.now() - started)),
            outcome: 'failed', error: error instanceof Error ? error.message : String(error),
          }
          await store.appendReceipt(receipt)
          throw error
        }
      })().finally(() => { inFlight.delete(asset) })
      inFlight.set(asset, task)
      return task
    },
  }
}

function healthFromMeta(id: string, label: string, meta: BarMeta, fallback: BarFallback | null): SourceHealth {
  const asOf = meta.freshness?.latestRecordAt ?? meta.to ?? null
  const stale = meta.staleTradingDays != null && meta.staleTradingDays > 2
  return {
    id, label, status: stale || fallback ? 'degraded' : 'ok',
    provider: meta.sourceId ?? meta.provider ?? 'OpenAlice BarService', asOf,
    detail: `${fallback ? `Preferred source ${fallback.from} failed; explicit ${fallback.to} fallback used (${fallback.reason}). ` : ''}${stale ? `${meta.staleTradingDays} weekday(s) behind the request anchor.` : `${meta.bars} attributed bars.`}`,
  }
}

async function maybeAlert(store: MarketMonitorStore, snapshot: MarketMonitorSnapshot, previous: MarketMonitorSnapshot | undefined, settings: MarketMonitorSettings): Promise<MarketMonitorAlert | null> {
  const changed = previous && previous.hypothesis.id !== snapshot.hypothesis.id
  const strong = snapshot.hypothesis.bias !== 'neutral' && snapshot.hypothesis.confidence >= settings.alertConfidence
  const abnormal = snapshot.metrics.intraday.abnormal
  if (!changed && !(strong && abnormal)) return null
  const alerts = await store.alerts(snapshot.asset, 20)
  const fingerprint = `${snapshot.asset}:${snapshot.hypothesis.id}:${snapshot.metrics.intraday.latestAt ?? snapshot.metrics.lastBarAt}`
  if (alerts.some((alert) => alert.fingerprint === fingerprint)) return null
  const alert: MarketMonitorAlert = {
    id: randomUUID(), asset: snapshot.asset, createdAt: snapshot.capturedAt, snapshotId: snapshot.id,
    severity: strong && abnormal ? 'warning' : 'info',
    title: changed ? `${snapshot.asset} evidence state changed` : `${snapshot.asset} abnormal intraday confirmation`,
    message: `${snapshot.hypothesis.label} · ${snapshot.hypothesis.confidence}% confidence. ${snapshot.metrics.intraday.note}`,
    fingerprint,
  }
  await store.appendAlert(alert)
  return alert
}
