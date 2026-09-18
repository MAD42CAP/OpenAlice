import type { HistoricalBar } from '../../api/market'
import type { MonitorAsset, MonitorHealthReport, MonitorReceipt, MonitorSnapshot } from '../../api/market-monitor'

/** Illustrative attempts only; the demo never runs a background scheduler. */
export function demoMonitorHealth(asset: MonitorAsset, hours: 24 | 72 = 24): MonitorHealthReport {
  const snapshot = demoMonitorSnapshot(asset)
  const generatedAt = '2026-09-12T12:36:00.000Z'
  const receipts: MonitorReceipt[] = [0, 1, 2].map((index) => ({
    id: `demo-health-${asset}-${index}`, asset,
    requestedAt: new Date(Date.parse('2026-09-12T12:05:00Z') + index * 900_000).toISOString(),
    completedAt: new Date(Date.parse('2026-09-12T12:05:00Z') + index * 900_000 + (index + 1) * 600).toISOString(),
    trigger: index ? 'scheduled' : 'manual', outcome: index ? 'duplicate' : 'stored',
    snapshotId: snapshot.id, strategyId: snapshot.strategyId, durationMs: (index + 1) * 600,
    sourceHealth: snapshot.sourceHealth.map(source => ({ ...source, status: source.id === 'context' && index === 0 ? 'degraded' : 'ok' })),
  }))
  return {
    schemaVersion: 1, asset, generatedAt,
    window: { hours, from: new Date(Date.parse(generatedAt) - hours * 3_600_000).toISOString(), to: generatedAt, firstSampleAt: receipts[0].completedAt!, lastSampleAt: receipts[2].completedAt!, sampleLimit: 5000, truncated: false },
    summary: { attempts: 3, successful: 3, failed: 0, stored: 1, duplicates: 2, scheduled: 2, manual: 1, narration: 0, successRatePercent: 100, consecutiveFailures: 0, recoveries: 0, lastSuccessAt: receipts[2].completedAt!, lastFailureAt: null, durationSamples: 3, averageDurationMs: 1200, p95DurationMs: 1800, scansWithSourceChecks: 3, scansWithSourceIssues: 1 },
    sources: snapshot.sourceHealth.map((source) => ({
      id: source.id, label: source.label, provider: source.provider, samples: 3,
      ok: source.id === 'context' ? 2 : 3, degraded: source.id === 'context' ? 1 : 0,
      unavailable: 0, recoveries: source.id === 'context' ? 1 : 0,
      latestStatus: 'ok', lastCheckedAt: receipts[2].completedAt!, lastDataAt: source.asOf,
    })),
    recent: receipts.reverse(),
  }
}

function bars(asset: MonitorAsset, interval: '1D' | '1H'): HistoricalBar[] {
  const count = interval === '1D' ? 150 : 96
  const config = asset === 'BTC'
    ? { base: 104_000, trend: 95, volume: 32_000 }
    : asset === 'TSLA'
      ? { base: 338, trend: 0.18, volume: 88_000_000 }
      : { base: 318, trend: 0.24, volume: 18_000_000 }
  const { base } = config
  const step = interval === '1D' ? 86400000 : 3600000
  const end = Date.parse(interval === '1D' ? '2026-09-11T00:00:00Z' : '2026-09-12T11:00:00Z')
  return Array.from({ length: count }, (_, index) => {
    const trend = index * config.trend
    const wave = Math.sin(index / (interval === '1D' ? 6 : 4)) * base * (interval === '1D' ? 0.018 : 0.004)
    const close = base + trend + wave
    const previous = index ? base + (index - 1) * config.trend + Math.sin((index - 1) / (interval === '1D' ? 6 : 4)) * base * (interval === '1D' ? 0.018 : 0.004) : close * 0.998
    const band = close * (interval === '1D' ? 0.009 : 0.002)
    return {
      date: interval === '1D' ? new Date(end - (count - index - 1) * step).toISOString().slice(0, 10) : new Date(end - (count - index - 1) * step).toISOString(),
      open: previous,
      high: Math.max(previous, close) + band,
      low: Math.min(previous, close) - band,
      close,
      volume: config.volume * (1 + Math.sin(index / 5) * 0.2),
    }
  })
}

export function demoMonitorSnapshot(asset: MonitorAsset, sequence = 0): MonitorSnapshot {
  const daily = bars(asset, '1D')
  const intraday = bars(asset, '1H')
  const last = daily.at(-1)!
  const bullish = asset === 'BTC'
  return {
    id: `demo-${asset.toLowerCase()}-${sequence}`,
    asset,
    capturedAt: new Date(Date.parse('2026-09-12T12:05:00Z') + sequence * 900000).toISOString(),
    trigger: sequence ? 'scheduled' : 'manual',
    strategyId: 'evidence-chain-v1',
    fingerprint: `demo-${asset}-${sequence}`,
    analysisBasis: { version: 2, closedBarsOnly: true, dailyAt: last.date, hourlyAt: intraday.at(-1)!.date },
    metrics: {
      lastPrice: last.close,
      lastBarAt: last.date,
      change1dPercent: bullish ? 1.34 : -0.62,
      change5dPercent: bullish ? 3.82 : 1.15,
      rangePosition60d: bullish ? 0.82 : 0.56,
      volumeRatio20d: bullish ? 1.42 : 0.94,
      weeklyChangePercent: bullish ? 2.75 : -0.45,
      intraday: { available: true, latestAt: intraday.at(-1)!.date, latestChangePercent: bullish ? 0.36 : -0.18, fourHourChangePercent: bullish ? 0.94 : -0.71, volumeRatio: bullish ? 1.31 : 1.08, abnormal: false, note: 'No abnormal hourly move or volume expansion detected.' },
    },
    hypothesis: bullish ? {
      id: 'demand-control', label: 'Demand has provisional control', bias: 'bullish', confidence: 74,
      summary: 'Price structure and follow-through lean constructive, but the interpretation remains conditional on the next test.',
      confirm: ['Hold above the prior 20-day range.', 'Pullbacks contract in volume and preserve a higher low.', 'Hourly follow-through produces price progress.'],
      invalidate: ['Return inside the range on expanding downside volume.', 'A lower high is followed by a decisive breakdown.'],
      alternatives: ['A false breakout returning to balance.', 'Short covering without durable spot demand.'],
    } : {
      id: 'balanced-range', label: 'Evidence remains balanced', bias: 'neutral', confidence: 56,
      summary: 'Neither side has produced enough structural progress. Directional stories remain provisional.',
      confirm: ['Continue rotating inside the prior 20-day range.', 'Volume expansion produces limited displacement.'],
      invalidate: ['Close outside the range and hold through a subsequent test.', 'Daily and weekly follow-through align.'],
      alternatives: ['Re-accumulation before continuation.', 'Distribution before a downside move.'],
    },
    evidence: [
      { id: 'location', label: 'Location in 60-day range', timeframe: '1D', tone: bullish ? 'positive' : 'neutral', observation: `Close is at ${bullish ? 82 : 56}% of the 60-day range.`, interpretation: 'Location changes how the same price/volume event should be interpreted.', weight: 2 },
      { id: 'structure', label: 'Twenty-day structure', timeframe: '1D', tone: bullish ? 'positive' : 'neutral', observation: bullish ? 'Close is above the prior 20-day high.' : 'Close remains inside the prior 20-day range.', interpretation: bullish ? 'Demand produced structural progress.' : 'The market still needs a confirmed range exit.', weight: 3 },
      { id: 'effort-result', label: 'Effort versus result', timeframe: '1D', tone: bullish ? 'positive' : 'neutral', observation: `${bullish ? 1.42 : 0.94}× volume with ${bullish ? 1.34 : -0.62}% price change.`, interpretation: 'Price displacement is compared with observed trading effort.', weight: 2 },
      { id: 'weekly', label: 'Weekly follow-through', timeframe: '1W', tone: bullish ? 'positive' : 'neutral', observation: `Latest week is ${bullish ? 2.75 : -0.45}% from the previous week.`, interpretation: 'Weekly direction provides context rather than a standalone signal.', weight: 2 },
      { id: 'intraday', label: 'Intraday pulse', timeframe: '1H', tone: bullish ? 'positive' : 'neutral', observation: `Latest hour ${bullish ? 0.36 : -0.18}%; rolling four hours ${bullish ? 0.94 : -0.71}%.`, interpretation: 'No abnormal hourly expansion detected.', weight: 1 },
    ],
    trend: {
      short: { horizon: 'short', direction: bullish ? 'bullish' : 'transition', regime: 'transition', score: bullish ? 44 : -8, confidence: bullish ? 67 : 53, signals: [] },
      medium: { horizon: 'medium', direction: bullish ? 'bullish' : 'sideways', regime: bullish ? 'trend' : 'range', score: bullish ? 72 : 10, confidence: bullish ? 77 : 54, signals: [] },
      long: { horizon: 'long', direction: bullish ? 'bullish' : 'bullish', regime: 'trend', score: bullish ? 61 : 48, confidence: bullish ? 73 : 68, signals: [] },
      alignment: bullish ? 'aligned-bullish' : 'mixed',
    },
    wyckoff: {
      phaseCandidate: bullish ? 'markup' : 'reaccumulation', confidence: bullish ? 75 : 60, testState: bullish ? 'confirmed' : 'pending',
      range: { lookback: 60, lower: bullish ? 101_500 : 310, upper: bullish ? 119_800 : 365, position: bullish ? 0.82 : 0.56, widthPercent: bullish ? 18.03 : 17.74 },
      events: bullish
        ? [{ kind: 'sign-of-strength', status: 'confirmed', at: daily.at(-3)!.date, level: 116_400 }]
        : [{ kind: 'last-point-of-support', status: 'candidate', at: daily.at(-2)!.date, level: 332 }],
      supportingEvidence: bullish ? ['range-high-location', 'sign-of-strength', 'successful-test'] : ['long-trend-supports'],
      opposingEvidence: bullish ? [] : ['no-defining-event'],
      confirmation: bullish ? ['hold-breakout', 'higher-low', 'positive-weekly-follow-through'] : ['hold-range-midpoint', 'quieter-pullback', 'break-range-high'],
      invalidation: bullish ? ['return-inside-range', 'failed-upside-test'] : ['lose-range-low', 'long-trend-deteriorates'],
    },
    dailyBrief: {
      cadence: 'daily-bar', periodKey: last.date.slice(0, 10), narrator: 'deterministic-v1',
      overallDirection: bullish ? 'bullish' : 'transition', confidence: bullish ? 72 : 58,
      alignment: bullish ? 'aligned-bullish' : 'mixed', phaseCandidate: bullish ? 'markup' : 'reaccumulation',
      headline: bullish ? 'aligned-bullish' : 'mixed',
      observations: bullish
        ? ['short-bullish', 'medium-bullish', 'long-bullish', 'wyckoff-markup']
        : ['short-transition', 'medium-sideways', 'long-bullish', 'wyckoff-reaccumulation'],
      watchFor: bullish ? ['hold-breakout', 'higher-low'] : ['hold-range-midpoint', 'break-range-high'],
      risks: bullish ? [] : ['mixed-timeframes', 'no-defining-event'],
    },
    aiNarration: {
      id: `demo-codex-${asset.toLowerCase()}`, asset, strategyId: 'evidence-chain-v1', periodKey: last.date.slice(0, 10),
      promptVersion: 'codex-daily-v1', generatedAt: '2026-09-12T17:30:00Z', language: 'zh-CN', agent: 'codex', model: 'gpt-5.6-sol', effort: 'medium',
      headline: bullish ? '多周期证据暂时一致偏多，但仍要观察突破后的承接。' : `${asset} 处于周期分歧阶段，暂按区间与转换结构处理。`,
      summary: bullish ? '价格结构、周线延续与日内脉冲相互支持，威科夫上涨阶段仍只是候选解释。' : '短中期尚未形成一致方向，长期结构偏强，当前不宜把单次波动解释成确定趋势。',
      shortTerm: bullish ? '短期偏多，小时级推进尚未异常扩张。' : '短期转换中，日内反弹和回落都缺少确认。',
      mediumTerm: bullish ? '中期趋势偏多，重点验证突破位是否转为支撑。' : '中期横盘，等待价格离开区间后完成测试。',
      longTerm: '长期结构仍偏多，但不能替代短中期确认。',
      evidence: bullish ? ['日线收盘位于 60 日区间上部。', '周线保持正向延续。'] : ['价格仍在此前区间内部。', '多周期方向暂不一致。'],
      risks: bullish ? ['若价格放量返回原区间，突破假设失效。'] : ['长期偏多可能使向下判断失真。'],
      watchFor: bullish ? ['观察回踩是否缩量并形成更高低点。'] : ['等待有效离开区间及后续测试。'],
      provenance: { workspaceId: 'demo-chat', runId: 'demo-run', issueId: 'mad42lab-market-daily-interpretation' },
    },
    context: asset === 'BTC' ? { fundingRate: 0.00012, openInterest: 812_500_000, annualizedBasisPercent: 5.7, optionOpenInterest: 198_400, putCallOpenInterestRatio: 0.78 } : asset === 'TSLA' ? { marketCap: 1_087_000_000_000, trailingPe: 186.4, forwardPe: 98.6, analystTargetMean: 352.5, shortPercentFloat: 2.74, nextEarningsAt: '2026-10-21', recentFilings: [{ form: '8-K', filingDate: '2026-09-10', reportDate: '2026-09-10', description: 'Current report', url: 'https://www.sec.gov/Archives/edgar/data/1318605/demo/tsla-8k.htm' }], recentNews: [{ title: 'Tesla delivery expectations remain in focus', time: '2026-09-12T09:00:00Z', source: 'Demo Wire' }] } : { marketCap: 95_000_000_000, analystTargetMean: 420, shortPercentFloat: 8.1, nextEarningsAt: '2026-10-29', recentFilings: [{ form: '10-Q', filingDate: '2026-08-01', reportDate: '2026-06-30', description: 'Quarterly report', url: 'https://www.sec.gov/Archives/edgar/data/1050446/demo/mstr-10q.htm' }], recentNews: [{ title: 'MSTR capital strategy remains in focus', time: '2026-09-12T08:30:00Z', source: 'Demo Wire' }] },
    sourceHealth: [
      { id: 'daily-bars', label: 'Daily OHLCV', status: 'ok', provider: asset === 'BTC' ? 'demo/coinbase' : 'demo/alpaca-iex', asOf: last.date, detail: 'Deterministic attributed demo bars.' },
      { id: 'intraday-bars', label: 'Hourly OHLCV', status: 'ok', provider: asset === 'BTC' ? 'demo/coinbase' : 'demo/alpaca-iex', asOf: intraday.at(-1)!.date, detail: 'Deterministic attributed hourly demo bars.' },
      { id: 'context', label: `${asset} context`, status: 'ok', provider: asset === 'BTC' ? 'demo/Deribit' : 'demo/OpenAlice reference', asOf: '2026-09-12T11:00:00Z', detail: 'Static context for UI acceptance; not live.' },
      ...(asset === 'BTC' ? [] : [{ id: `${asset.toLowerCase()}-sec-filings`, label: `${asset} SEC filings`, status: 'ok' as const, provider: 'demo/SEC EDGAR', asOf: '2026-09-12T11:00:00Z', detail: '1 recent material filings loaded from the official submissions feed.' }]),
    ],
    chart: {
      daily, intraday,
      dailyMeta: { symbol: asset === 'BTC' ? 'BTC-USD' : asset, from: daily[0].date, to: last.date, bars: daily.length, source: 'vendor', sourceId: asset === 'BTC' ? 'demo/coinbase' : 'demo/alpaca-iex', barId: `demo|${asset}`, provider: 'demo', barCapability: asset === 'BTC' ? 'realtime' : 'iex' },
      intradayMeta: { symbol: asset === 'BTC' ? 'BTC-USD' : asset, from: intraday[0].date, to: intraday.at(-1)!.date, bars: intraday.length, source: 'vendor', sourceId: asset === 'BTC' ? 'demo/coinbase' : 'demo/alpaca-iex', barId: `demo|${asset}`, provider: 'demo', barCapability: asset === 'BTC' ? 'realtime' : 'iex' },
    },
  }
}
