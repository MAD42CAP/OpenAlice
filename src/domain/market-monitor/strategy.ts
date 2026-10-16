import { createHash } from 'node:crypto'
import type { OhlcvBar } from '../market-data/bars/index.js'
import { analyzeEvidence, semanticFingerprint } from './analysis.js'
import { selectAnalysisHourlyBars } from './equity-session.js'
import {
  DEFAULT_MARKET_MONITOR_STRATEGY_ID,
  type EvidenceItem,
  type MarketContext,
  type MarketHypothesis,
  type MarketDailyBrief,
  type MarketMonitorAsset,
  type MarketMonitorMetrics,
  type MarketMonitorStrategyManifest,
  type MultiTimeframeTrend,
  type SourceHealth,
  type WyckoffAssessment,
} from './types.js'

export interface MarketMonitorStrategyInput {
  asset: MarketMonitorAsset
  asOf?: Date
  dailyBars: OhlcvBar[]
  intradayBars: OhlcvBar[]
  abnormalVolumeRatio: number
  abnormalMovePercent: number
}

export interface MarketMonitorStrategyOutput {
  metrics: MarketMonitorMetrics
  evidence: EvidenceItem[]
  hypothesis: MarketHypothesis
  trend: MultiTimeframeTrend
  wyckoff: WyckoffAssessment
  dailyBrief: MarketDailyBrief
}

export interface MarketMonitorFingerprintInput extends MarketMonitorStrategyOutput {
  asset: MarketMonitorAsset
  context: MarketContext
  sourceHealth: SourceHealth[]
}

export interface MarketMonitorStrategy {
  manifest: MarketMonitorStrategyManifest
  analyze(input: MarketMonitorStrategyInput): MarketMonitorStrategyOutput
  fingerprint(input: MarketMonitorFingerprintInput): string
}

export class MarketMonitorStrategyRegistry {
  private readonly byId = new Map<string, MarketMonitorStrategy>()
  private readonly byVersion = new Map<string, MarketMonitorStrategy>()

  constructor(strategies: MarketMonitorStrategy[], historical: MarketMonitorStrategy[] = []) {
    for (const strategy of strategies) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(strategy.manifest.id)) {
        throw new Error(`Invalid market monitor strategy id: ${strategy.manifest.id}`)
      }
      if (this.byId.has(strategy.manifest.id)) throw new Error(`Duplicate market monitor strategy: ${strategy.manifest.id}`)
      this.byId.set(strategy.manifest.id, strategy)
      this.byVersion.set(`${strategy.manifest.id}:${strategy.manifest.version}`, strategy)
    }
    if (!this.byId.size) throw new Error('At least one market monitor strategy is required')
    for (const strategy of historical) {
      const key = `${strategy.manifest.id}:${strategy.manifest.version}`
      if (this.byVersion.has(key)) throw new Error(`Duplicate market monitor strategy version: ${key}`)
      this.byVersion.set(key, strategy)
    }
  }

  get(id: string): MarketMonitorStrategy {
    const strategy = this.byId.get(id)
    if (!strategy) throw new Error(`Unknown market monitor strategy: ${id}`)
    return strategy
  }

  /** Historical implementations are replay-only and never appear in active discovery. */
  getVersion(id: string, version: number): MarketMonitorStrategy | undefined {
    return this.byVersion.get(`${id}:${version}`)
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  list(): MarketMonitorStrategyManifest[] {
    return [...this.byId.values()].map(({ manifest }) => ({ ...manifest, requiredData: [...manifest.requiredData] }))
  }
}

export const evidenceChainV2Strategy: MarketMonitorStrategy = {
  manifest: {
    id: DEFAULT_MARKET_MONITOR_STRATEGY_ID,
    label: 'Evidence chain',
    version: 2,
    description: 'Location, structure, effort/result, weekly follow-through and an independent hourly test.',
    requiredData: ['daily-bars', 'hourly-bars', 'asset-context'],
  },
  analyze: analyzeEvidence,
  fingerprint: semanticFingerprint,
}

export const evidenceChainV1Strategy: MarketMonitorStrategy = {
  manifest: {
    ...evidenceChainV2Strategy.manifest,
    version: 3,
    description: 'Completed regular-session equity hours with comparable-session volume quality; unchanged crypto evidence.',
  },
  analyze(input) {
    if (input.asset === 'BTC') return analyzeEvidence(input)
    const selection = selectAnalysisHourlyBars(input.intradayBars, input.asset, input.asOf ?? new Date(), input)
    return analyzeEvidence({ ...input, intradayBars: selection.bars }, selection.pulse)
  },
  fingerprint(input) {
    const event = input.context.earningsEvent
    // No added key on old archives: their exact v3 identity stays reproducible.
    // A genuine new verification (cached reads preserve this time) is evidence;
    // polling text and error detail are not a new analysis observation.
    const earnings = event ? { asset: event.asset, status: event.status, date: event.date, timing: event.timing,
      webcastAt: event.webcastAt, sourceUrl: event.sourceUrl, publishedAt: event.publishedAt,
      retrievedAt: event.status === 'confirmed' ? event.retrievedAt : null,
      contentHash: event.contentHash, verification: event.verification, referenceDate: event.referenceDate ?? null } : undefined
    return createHash('sha256').update(JSON.stringify({ strategyVersion: 3, evidence: semanticFingerprint(input), ...(earnings ? { earnings } : {}) })).digest('hex')
  },
}

export function createMarketMonitorStrategyRegistry(additional: MarketMonitorStrategy[] = []): MarketMonitorStrategyRegistry {
  return new MarketMonitorStrategyRegistry([evidenceChainV1Strategy, ...additional], [evidenceChainV2Strategy])
}
