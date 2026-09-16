import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { MarketMonitorStrategyRegistry, MarketMonitorStrategyInput, MarketMonitorStrategyOutput } from './strategy.js'
import type { MarketMonitorSnapshot } from './types.js'
import { createDailyMarketBrief } from './daily-brief.js'

/** Public market observations only; never persist request/auth configuration. */
export interface MarketAnalysisArchive {
  schemaVersion: 1
  input: Omit<MarketMonitorStrategyInput, 'asOf'> & {
    asOf: string
    strategyId: string
    strategyVersion: number
    context: MarketMonitorSnapshot['context']
    sourceHealth: MarketMonitorSnapshot['sourceHealth']
  }
  snapshot: MarketMonitorSnapshot
}

export interface MarketReplayResult {
  status: 'verified' | 'mismatch' | 'unavailable' | 'unsupported'
  snapshotId: string
  archive?: MarketAnalysisArchive
  recomputed?: MarketMonitorStrategyOutput
  differences?: string[]
}

export function analysisInputHash(input: MarketAnalysisArchive['input']): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

export function replayAnalysis(archive: MarketAnalysisArchive, registry: MarketMonitorStrategyRegistry): MarketReplayResult {
  const { input, snapshot } = archive
  const base = { snapshotId: snapshot.id, archive }
  if (archive.schemaVersion !== 1 || !registry.has(input.strategyId)
    || registry.get(input.strategyId).manifest.version !== input.strategyVersion) {
    return { ...base, status: 'unsupported' }
  }
  const strategy = registry.get(input.strategyId)
  const analysis = strategy.analyze({ ...input, asOf: new Date(input.asOf) })
  const recomputed = { ...analysis, dailyBrief: createDailyMarketBrief({ ...analysis, sourceHealth: input.sourceHealth }) }
  const differences = (Object.keys(recomputed) as Array<keyof MarketMonitorStrategyOutput>)
    .filter(key => !isDeepStrictEqual(recomputed[key], snapshot[key])) as string[]
  for (const key of ['context', 'sourceHealth'] as const) {
    if (!isDeepStrictEqual(input[key], snapshot[key])) differences.push(key)
  }
  if (strategy.fingerprint({ asset: input.asset, ...recomputed, context: input.context, sourceHealth: input.sourceHealth }) !== snapshot.fingerprint) differences.push('fingerprint')
  return { ...base, status: differences.length ? 'mismatch' : 'verified', recomputed, differences }
}
