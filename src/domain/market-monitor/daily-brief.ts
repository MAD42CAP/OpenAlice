import type {
  MarketDailyBrief,
  MarketMonitorMetrics,
  MultiTimeframeTrend,
  SourceHealth,
  TrendDirection,
  WyckoffAssessment,
} from './types.js'

export function createDailyMarketBrief(input: {
  metrics: MarketMonitorMetrics
  trend: MultiTimeframeTrend
  wyckoff: WyckoffAssessment
  sourceHealth?: SourceHealth[]
}): MarketDailyBrief {
  const available = [input.trend.short, input.trend.medium, input.trend.long]
    .filter((assessment) => assessment.direction !== 'insufficient')
  const confidence = available.length
    ? Math.round(available.reduce((sum, assessment) => sum + assessment.confidence, 0) / available.length)
    : 0
  let overallDirection: TrendDirection
  switch (input.trend.alignment) {
    case 'aligned-bullish': overallDirection = 'bullish'; break
    case 'aligned-bearish': overallDirection = 'bearish'; break
    case 'range': overallDirection = 'sideways'; break
    case 'mixed': overallDirection = 'transition'; break
    default: overallDirection = 'insufficient'
  }
  const risks: string[] = []
  if (input.trend.alignment === 'mixed') risks.push('mixed-timeframes')
  if (!input.metrics.intraday.available) risks.push('intraday-unavailable')
  if (input.sourceHealth?.some((source) => source.status !== 'ok')) risks.push('source-issues')
  risks.push(...input.wyckoff.opposingEvidence.slice(0, 2))
  return {
    cadence: 'daily-bar',
    periodKey: input.metrics.lastBarAt.slice(0, 10),
    narrator: 'deterministic-v1',
    overallDirection,
    confidence,
    alignment: input.trend.alignment,
    phaseCandidate: input.wyckoff.phaseCandidate,
    headline: input.trend.alignment,
    observations: [
      `short-${input.trend.short.direction}`,
      `medium-${input.trend.medium.direction}`,
      `long-${input.trend.long.direction}`,
      `wyckoff-${input.wyckoff.phaseCandidate}`,
    ],
    watchFor: input.wyckoff.confirmation.slice(0, 3),
    risks: [...new Set(risks)],
  }
}
