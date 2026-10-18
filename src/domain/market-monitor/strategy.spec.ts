import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { analysisInputHash, replayAnalysis, type MarketAnalysisArchive } from './replay.js'
import { createDailyMarketBrief } from './daily-brief.js'
import { MarketMonitorStrategyRegistry, createMarketMonitorStrategyRegistry, evidenceChainV1Strategy, evidenceChainV2Strategy, evidenceChainV3Strategy, evidenceChainV4Strategy } from './strategy.js'
import { regularEquitySession } from './equity-session.js'

describe('market monitor strategy registry', () => {
  it('rejects duplicate identities and protects manifest arrays from mutation', () => {
    expect(() => new MarketMonitorStrategyRegistry([evidenceChainV1Strategy, evidenceChainV1Strategy])).toThrow(/Duplicate/)
    const registry = new MarketMonitorStrategyRegistry([evidenceChainV1Strategy])
    const listed = registry.list()
    listed[0]!.requiredData.length = 0
    expect(registry.get('evidence-chain-v1').manifest.requiredData).toHaveLength(3)
  })

  it('rejects an unknown strategy instead of silently falling back', () => {
    const registry = new MarketMonitorStrategyRegistry([evidenceChainV1Strategy])
    expect(() => registry.get('unknown')).toThrow(/Unknown market monitor strategy/)
  })

  it('rejects ids that cannot be used as stable persistence keys', () => {
    expect(() => new MarketMonitorStrategyRegistry([{
      ...evidenceChainV1Strategy,
      manifest: { ...evidenceChainV1Strategy.manifest, id: 'bad/strategy' },
    }])).toThrow(/Invalid market monitor strategy id/)
  })
})


function fixedInput(asset: 'MSTR' | 'BTC' = 'MSTR') {
  const dailyBars = Array.from({ length: 90 }, (_, index) => ({ date: new Date(Date.parse('2026-10-15T00:00:00Z') - (90 - index) * 86400000).toISOString(), open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 1000 + index }))
  const intradayBars = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].flatMap(day => [14, 15, 16, 17, 18, 19].map((hour, i) => ({ date: `${day}T${hour}:00:00Z`, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1000 })))
  intradayBars.push({ date: '2026-10-15T20:00:00Z', open: 106, high: 107, low: 50, close: 50, volume: 1 })
  return { asset, asOf: new Date('2026-10-16T01:00:00Z'), dailyBars, intradayBars, abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5 }
}

describe('versioned equity input policy', () => {
  it('keeps the pre-change v2 deterministic output frozen while v3 excludes the post-close shock', () => {
    const input = fixedInput()
    const saved = structuredClone(input)
    const legacy = evidenceChainV2Strategy.analyze(input)
    // Recorded from the unmodified HEAD implementation, not a v3-derived label.
    expect(createHash('sha256').update(JSON.stringify(legacy)).digest('hex')).toBe('c09510e83e1c51f7dcf990f30ea3522d87df3fa83707212e36d5d014f8e5d58f')
    const current = evidenceChainV1Strategy.analyze(input)
    // Frozen before adding the prospective v4 medium policy.
    expect(createHash('sha256').update(JSON.stringify(current)).digest('hex')).toBe('9ff6603959642318e0cbd9b52e433a007215b51b442c65926270bd01a5e328dc')
    expect(current.metrics.intraday).toMatchObject({ latestAt: '2026-10-15T19:00:00Z', latestChangePercent: 0.95, fourHourChangePercent: 3.92, volumeRatio: 1 })
    expect(current.trend.short.signals.find(signal => signal.id === 'short-hour-momentum')).toMatchObject({ tone: 'positive', value: 0.95 })
    expect(current.evidence.find(item => item.id === 'intraday')?.tone).toBe('positive')
    expect(current.hypothesis).not.toEqual(legacy.hypothesis)
    expect(input).toEqual(saved)
  })

  it('keeps BTC analysis numerically unchanged and exposes only v4 for active discovery', () => {
    const input = fixedInput('BTC')
    expect(evidenceChainV1Strategy.analyze(input)).toEqual(evidenceChainV2Strategy.analyze(input))
    expect(evidenceChainV4Strategy.analyze(input)).toEqual(evidenceChainV3Strategy.analyze(input))
    const registry = createMarketMonitorStrategyRegistry()
    expect(registry.list()).toMatchObject([{ id: 'evidence-chain-v1', version: 4 }])
    expect(registry.getVersion('evidence-chain-v1', 2)).toBe(evidenceChainV2Strategy)
    expect(registry.getVersion('evidence-chain-v1', 3)).toBe(evidenceChainV3Strategy)
    expect(registry.getVersion('evidence-chain-v1', 4)).toBe(evidenceChainV4Strategy)
    expect(registry.getVersion('evidence-chain-v1', 999)).toBeUndefined()
  })

  it.each([2, 3, 4])('replays immutable version %s inputs with their own implementation', version => {
    const strategy = version === 2 ? evidenceChainV2Strategy : version === 3 ? evidenceChainV3Strategy : evidenceChainV4Strategy
    const fixture = fixedInput()
    if (version === 4) fixture.dailyBars = fixture.dailyBars.filter(bar => regularEquitySession(bar.date.slice(0, 10)).trading)
    const input = { ...fixture, asOf: fixture.asOf.toISOString(), strategyId: strategy.manifest.id, strategyVersion: version, context: {}, sourceHealth: [] }
    const analysis = strategy.analyze(fixture)
    const result = { ...analysis, dailyBrief: createDailyMarketBrief({ ...analysis, sourceHealth: [] }) }
    const archive: MarketAnalysisArchive = { schemaVersion: 1, input, snapshot: {
      id: '00000000-0000-4000-8000-000000000001', asset: 'MSTR', capturedAt: input.asOf, trigger: 'manual',
      strategyId: input.strategyId, ...result, context: {}, sourceHealth: [],
      fingerprint: strategy.fingerprint({ ...result, asset: 'MSTR', context: {}, sourceHealth: [] }),
      analysisInput: { hash: analysisInputHash(input), strategyVersion: version },
      chart: { daily: input.dailyBars, intraday: input.intradayBars, dailyMeta: { symbol: 'MSTR', from: input.dailyBars[0]!.date, to: input.dailyBars.at(-1)!.date, bars: input.dailyBars.length }, intradayMeta: null },
    } }
    const before = JSON.stringify(archive)
    expect(replayAnalysis(archive, createMarketMonitorStrategyRegistry())).toMatchObject({ status: 'verified', differences: [] })
    expect(JSON.stringify(archive)).toBe(before)
  })

  it('separates the prospective v4 fingerprint from a v3 publication with identical background evidence', () => {
    const input = fixedInput('BTC'), analysis = evidenceChainV3Strategy.analyze(input)
    const fingerprintInput = { ...analysis, asset: input.asset, context: {}, sourceHealth: [] }
    expect(evidenceChainV4Strategy.fingerprint(fingerprintInput)).not.toBe(evidenceChainV3Strategy.fingerprint(fingerprintInput))
  })

  it('does not turn a low-volume regular-session last print into negative hourly rule evidence', () => {
    const input = fixedInput()
    input.intradayBars.pop()
    Object.assign(input.intradayBars.at(-1)!, { close: 50, low: 49, volume: 1 })
    const current = evidenceChainV1Strategy.analyze(input)
    expect(current.metrics.intraday).toMatchObject({ available: false, latestChangePercent: null, fourHourChangePercent: null, volumeRatio: null })
    expect(current.trend.short.signals.filter(signal => signal.id.startsWith('short-hour') || signal.id === 'short-four-hour-momentum').every(signal => signal.value === null)).toBe(true)
    expect(current.evidence.find(item => item.id === 'intraday')?.tone).toBe('neutral')
  })

  it('archives changed official event semantics and genuine reverification while ignoring polling text', () => {
    const analyzed = evidenceChainV1Strategy.analyze(fixedInput())
    const base = { ...analyzed, asset: 'MSTR' as const, context: {} as import('./types.js').MarketContext, sourceHealth: [] }
    const old = evidenceChainV1Strategy.fingerprint(base)
    base.context.earningsEvent = { asset: 'MSTR', status: 'confirmed', date: '2026-10-29', timing: 'after-close', webcastAt: null,
      sourceUrl: 'https://www.strategy.com/press/synthetic-earnings', title: 'Synthetic', publishedAt: '2026-10-08', retrievedAt: '2026-10-15T20:00:00Z',
      contentHash: 'b'.repeat(64), verification: 'live-official', detail: 'Initial fetch' }
    const first = evidenceChainV1Strategy.fingerprint(base); expect(first).not.toBe(old)
    base.context.earningsEvent.detail = 'Same cached result, polled later'
    expect(evidenceChainV1Strategy.fingerprint(base)).toBe(first)
    base.context.earningsEvent.timing = 'before-open'
    expect(evidenceChainV1Strategy.fingerprint(base)).not.toBe(first)
    base.context.earningsEvent.timing = 'after-close'; base.context.earningsEvent.retrievedAt = '2026-10-16T10:00:00Z'
    expect(evidenceChainV1Strategy.fingerprint(base)).not.toBe(first)
  })
})
