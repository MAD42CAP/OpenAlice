import type { TFunction } from 'i18next'
import type {
  EvidenceItem,
  MonitorAlert,
  MonitorSnapshot,
  SourceHealth,
  TrendDirection,
  TrendRegime,
  WyckoffEventKind,
  WyckoffPhaseCandidate,
} from '../../api/market-monitor'

type Translate = TFunction<'translation'>
type FormatNumber = (value: unknown, digits?: number) => string

export function monitorStrategyLabel(t: Translate, id: string, fallback: string): string {
  return id === 'evidence-chain-v1' ? t('marketMonitor.strategyEvidenceChain') : fallback
}

export function monitorTrendDirectionLabel(t: Translate, direction: TrendDirection): string {
  switch (direction) {
    case 'bullish': return t('marketMonitor.trend.bullish')
    case 'bearish': return t('marketMonitor.trend.bearish')
    case 'sideways': return t('marketMonitor.trend.sideways')
    case 'transition': return t('marketMonitor.trend.transition')
    case 'insufficient': return t('marketMonitor.trend.insufficient')
  }
}

export function monitorTrendRegimeLabel(t: Translate, regime: TrendRegime): string {
  switch (regime) {
    case 'trend': return t('marketMonitor.trend.trend')
    case 'range': return t('marketMonitor.trend.range')
    case 'transition': return t('marketMonitor.trend.transitionRegime')
    case 'unknown': return t('marketMonitor.trend.unknown')
  }
}

export function monitorHorizonLabel(t: Translate, horizon: 'short' | 'medium' | 'long'): string {
  return horizon === 'short' ? t('marketMonitor.trend.short')
    : horizon === 'medium' ? t('marketMonitor.trend.medium')
      : t('marketMonitor.trend.long')
}

export function monitorBriefHeadline(t: Translate, headline: string): string {
  switch (headline) {
    case 'aligned-bullish': return t('marketMonitor.brief.headlineAlignedBullish')
    case 'aligned-bearish': return t('marketMonitor.brief.headlineAlignedBearish')
    case 'range': return t('marketMonitor.brief.headlineRange')
    case 'mixed': return t('marketMonitor.brief.headlineMixed')
    default: return t('marketMonitor.brief.headlineInsufficient')
  }
}

export function monitorWyckoffPhaseLabel(t: Translate, phase: WyckoffPhaseCandidate): string {
  switch (phase) {
    case 'accumulation': return t('marketMonitor.wyckoff.accumulation')
    case 'markup': return t('marketMonitor.wyckoff.markup')
    case 'distribution': return t('marketMonitor.wyckoff.distribution')
    case 'markdown': return t('marketMonitor.wyckoff.markdown')
    case 'reaccumulation': return t('marketMonitor.wyckoff.reaccumulation')
    case 'redistribution': return t('marketMonitor.wyckoff.redistribution')
    case 'indeterminate': return t('marketMonitor.wyckoff.indeterminate')
  }
}

export function monitorWyckoffEventLabel(t: Translate, kind: WyckoffEventKind): string {
  switch (kind) {
    case 'spring': return t('marketMonitor.wyckoff.spring')
    case 'test': return t('marketMonitor.wyckoff.test')
    case 'sign-of-strength': return t('marketMonitor.wyckoff.signOfStrength')
    case 'last-point-of-support': return t('marketMonitor.wyckoff.lastPointOfSupport')
    case 'upthrust': return t('marketMonitor.wyckoff.upthrust')
    case 'upthrust-after-distribution': return t('marketMonitor.wyckoff.utad')
    case 'sign-of-weakness': return t('marketMonitor.wyckoff.signOfWeakness')
    case 'last-point-of-supply': return t('marketMonitor.wyckoff.lastPointOfSupply')
  }
}

export function monitorWyckoffEventStatus(t: Translate, status: 'candidate' | 'confirmed' | 'invalidated'): string {
  return status === 'candidate' ? t('marketMonitor.wyckoff.eventCandidate')
    : status === 'confirmed' ? t('marketMonitor.wyckoff.eventConfirmed')
      : t('marketMonitor.wyckoff.eventInvalidated')
}

export function monitorWyckoffTestLabel(t: Translate, state: 'none' | 'pending' | 'confirmed' | 'invalidated'): string {
  return state === 'none' ? t('marketMonitor.wyckoff.testNone')
    : state === 'pending' ? t('marketMonitor.wyckoff.testPending')
      : state === 'confirmed' ? t('marketMonitor.wyckoff.testConfirmed')
        : t('marketMonitor.wyckoff.testInvalidated')
}

export function monitorWyckoffEvidence(t: Translate, id: string): string {
  switch (id) {
    case 'range-low-location': return t('marketMonitor.wyckoff.rangeLowLocation')
    case 'range-high-location': return t('marketMonitor.wyckoff.rangeHighLocation')
    case 'high-effort-small-result': return t('marketMonitor.wyckoff.highEffortSmallResult')
    case 'spring-reclaim': return t('marketMonitor.wyckoff.springReclaim')
    case 'upthrust-rejection': return t('marketMonitor.wyckoff.upthrustRejection')
    case 'sign-of-strength': return t('marketMonitor.wyckoff.signOfStrengthEvidence')
    case 'sign-of-weakness': return t('marketMonitor.wyckoff.signOfWeaknessEvidence')
    case 'successful-test': return t('marketMonitor.wyckoff.successfulTest')
    case 'long-trend-supports': return t('marketMonitor.wyckoff.longTrendSupports')
    case 'insufficient-range-data': return t('marketMonitor.wyckoff.insufficientRangeData')
    case 'no-defining-event': return t('marketMonitor.brief.noDefiningEvent')
    case 'no-absorption-evidence': return t('marketMonitor.brief.noAbsorptionEvidence')
    case 'long-trend-bullish': return t('marketMonitor.brief.longTrendBullish')
    case 'long-trend-bearish': return t('marketMonitor.brief.longTrendBearish')
    default: return id
  }
}

export function monitorWyckoffCondition(t: Translate, id: string): string {
  const copy: Record<string, string> = {
    'hold-range-low': t('marketMonitor.wyckoff.holdRangeLow'),
    'quieter-secondary-test': t('marketMonitor.wyckoff.quieterSecondaryTest'),
    'break-range-high': t('marketMonitor.wyckoff.breakRangeHigh'),
    'close-below-spring-low': t('marketMonitor.wyckoff.closeBelowSpringLow'),
    'downside-expansion': t('marketMonitor.wyckoff.downsideExpansion'),
    'hold-range-midpoint': t('marketMonitor.wyckoff.holdRangeMidpoint'),
    'quieter-pullback': t('marketMonitor.wyckoff.quieterPullback'),
    'lose-range-low': t('marketMonitor.wyckoff.loseRangeLow'),
    'long-trend-deteriorates': t('marketMonitor.wyckoff.longTrendDeteriorates'),
    'hold-breakout': t('marketMonitor.wyckoff.holdBreakout'),
    'higher-low': t('marketMonitor.wyckoff.higherLow'),
    'positive-weekly-follow-through': t('marketMonitor.wyckoff.positiveWeeklyFollowThrough'),
    'return-inside-range': t('marketMonitor.wyckoff.returnInsideRange'),
    'failed-upside-test': t('marketMonitor.wyckoff.failedUpsideTest'),
    'reject-range-high': t('marketMonitor.wyckoff.rejectRangeHigh'),
    'weaker-secondary-test': t('marketMonitor.wyckoff.weakerSecondaryTest'),
    'break-range-low': t('marketMonitor.wyckoff.breakRangeLow'),
    'close-above-upthrust-high': t('marketMonitor.wyckoff.closeAboveUpthrustHigh'),
    'upside-expansion': t('marketMonitor.wyckoff.upsideExpansion'),
    'stay-below-range-midpoint': t('marketMonitor.wyckoff.stayBelowRangeMidpoint'),
    'weak-rally': t('marketMonitor.wyckoff.weakRally'),
    'reclaim-range-high': t('marketMonitor.wyckoff.reclaimRangeHigh'),
    'long-trend-improves': t('marketMonitor.wyckoff.longTrendImproves'),
    'stay-below-breakdown': t('marketMonitor.wyckoff.stayBelowBreakdown'),
    'lower-high': t('marketMonitor.wyckoff.lowerHigh'),
    'negative-weekly-follow-through': t('marketMonitor.wyckoff.negativeWeeklyFollowThrough'),
    'reclaim-range': t('marketMonitor.wyckoff.reclaimRange'),
    'failed-downside-test': t('marketMonitor.wyckoff.failedDownsideTest'),
    'range-event-needs-test': t('marketMonitor.wyckoff.rangeEventNeedsTest'),
    'wait-for-structural-progress': t('marketMonitor.wyckoff.waitForStructuralProgress'),
    'new-range-invalidates-reading': t('marketMonitor.wyckoff.newRangeInvalidatesReading'),
  }
  return copy[id] ?? id
}

export function monitorBriefObservation(t: Translate, id: string): string {
  if (id.startsWith('wyckoff-')) return monitorWyckoffPhaseLabel(t, id.slice('wyckoff-'.length) as WyckoffPhaseCandidate)
  const split = id.indexOf('-')
  if (split < 0) return id
  const horizon = id.slice(0, split) as 'short' | 'medium' | 'long'
  const direction = id.slice(split + 1) as TrendDirection
  return `${monitorHorizonLabel(t, horizon)}：${monitorTrendDirectionLabel(t, direction)}`
}

export function monitorBriefRisk(t: Translate, id: string): string {
  if (id === 'source-issues') return t('marketMonitor.brief.sourceIssues')
  if (id === 'mixed-timeframes') return t('marketMonitor.brief.mixedTimeframes')
  if (id === 'intraday-unavailable') return t('marketMonitor.brief.intradayUnavailable')
  return monitorWyckoffEvidence(t, id)
}

export function monitorIntradayNote(t: Translate, snapshot: MonitorSnapshot): string {
  const pulse = snapshot.metrics.intraday
  if (!pulse.available) return t('marketMonitor.evidence.intradayUnavailable')
  return pulse.abnormal
    ? t('marketMonitor.evidence.intradayAbnormal')
    : t('marketMonitor.evidence.intradayNormal')
}

export function monitorEvidenceCopy(
  t: Translate,
  snapshot: MonitorSnapshot,
  item: EvidenceItem,
  formatNumber: FormatNumber,
): Pick<EvidenceItem, 'label' | 'observation' | 'interpretation'> {
  const metric = snapshot.metrics
  switch (item.id) {
    case 'location':
      return {
        label: t('marketMonitor.evidence.locationLabel'),
        observation: metric.rangePosition60d == null
          ? t('marketMonitor.evidence.locationUnavailable')
          : t('marketMonitor.evidence.locationObserved', { position: Math.round(metric.rangePosition60d * 100) }),
        interpretation: t('marketMonitor.evidence.locationInterpretation'),
      }
    case 'structure':
      return {
        label: t('marketMonitor.evidence.structureLabel'),
        observation: item.tone === 'positive'
          ? t('marketMonitor.evidence.structureAbove')
          : item.tone === 'negative'
            ? t('marketMonitor.evidence.structureBelow')
            : t('marketMonitor.evidence.structureInside'),
        interpretation: item.tone === 'positive'
          ? t('marketMonitor.evidence.demandProgress')
          : item.tone === 'negative'
            ? t('marketMonitor.evidence.supplyProgress')
            : t('marketMonitor.evidence.needsRangeExit'),
      }
    case 'effort-result': {
      const absorption = item.interpretation.startsWith('High effort')
      return {
        label: t('marketMonitor.evidence.effortLabel'),
        observation: t('marketMonitor.evidence.effortObserved', {
          volume: formatNumber(metric.volumeRatio20d),
          change: formatNumber(metric.change1dPercent),
        }),
        interpretation: absorption
          ? t('marketMonitor.evidence.absorption')
          : t('marketMonitor.evidence.effortMatches'),
      }
    }
    case 'weekly':
      return {
        label: t('marketMonitor.evidence.weeklyLabel'),
        observation: t('marketMonitor.evidence.weeklyObserved', { change: formatNumber(metric.weeklyChangePercent) }),
        interpretation: t('marketMonitor.evidence.weeklyInterpretation'),
      }
    case 'intraday':
      return {
        label: t('marketMonitor.evidence.intradayLabel'),
        observation: metric.intraday.available
          ? t('marketMonitor.evidence.intradayObserved', {
              hour: formatNumber(metric.intraday.latestChangePercent),
              fourHours: formatNumber(metric.intraday.fourHourChangePercent),
              volume: formatNumber(metric.intraday.volumeRatio),
            })
          : t('marketMonitor.evidence.intradayUnavailable'),
        interpretation: metric.intraday.available
          ? monitorIntradayNote(t, snapshot)
          : t('marketMonitor.evidence.intradayUnknown'),
      }
    default:
      return item
  }
}

export function monitorHypothesisCopy(t: Translate, snapshot: MonitorSnapshot) {
  switch (snapshot.hypothesis.id) {
    case 'demand-control':
      return {
        label: t('marketMonitor.hypothesis.demandLabel'),
        summary: t('marketMonitor.hypothesis.demandSummary'),
        confirm: [t('marketMonitor.hypothesis.demandConfirm1'), t('marketMonitor.hypothesis.demandConfirm2'), t('marketMonitor.hypothesis.demandConfirm3')],
        invalidate: [t('marketMonitor.hypothesis.demandInvalidate1'), t('marketMonitor.hypothesis.demandInvalidate2'), t('marketMonitor.hypothesis.demandInvalidate3')],
        alternatives: [t('marketMonitor.hypothesis.demandAlternative1'), t('marketMonitor.hypothesis.demandAlternative2')],
      }
    case 'supply-control':
      return {
        label: t('marketMonitor.hypothesis.supplyLabel'),
        summary: t('marketMonitor.hypothesis.supplySummary'),
        confirm: [t('marketMonitor.hypothesis.supplyConfirm1'), t('marketMonitor.hypothesis.supplyConfirm2'), t('marketMonitor.hypothesis.supplyConfirm3')],
        invalidate: [t('marketMonitor.hypothesis.supplyInvalidate1'), t('marketMonitor.hypothesis.supplyInvalidate2'), t('marketMonitor.hypothesis.supplyInvalidate3')],
        alternatives: [t('marketMonitor.hypothesis.supplyAlternative1'), t('marketMonitor.hypothesis.supplyAlternative2')],
      }
    case 'balanced-range':
      return {
        label: t('marketMonitor.hypothesis.balancedLabel'),
        summary: t('marketMonitor.hypothesis.balancedSummary'),
        confirm: [t('marketMonitor.hypothesis.balancedConfirm1'), t('marketMonitor.hypothesis.balancedConfirm2')],
        invalidate: [t('marketMonitor.hypothesis.balancedInvalidate1'), t('marketMonitor.hypothesis.balancedInvalidate2')],
        alternatives: [t('marketMonitor.hypothesis.balancedAlternative1'), t('marketMonitor.hypothesis.balancedAlternative2')],
      }
  }
}

export function monitorSourceLabel(t: Translate, source: Pick<SourceHealth, 'id' | 'label'>, asset?: string): string {
  const equityAsset = source.id.match(/^([a-z0-9]+)-(?:reference|calendar-news|sec-filings)$/)?.[1]?.toUpperCase()
  switch (source.id) {
    case 'daily-bars': return t('marketMonitor.source.dailyBars')
    case 'intraday-bars': return t('marketMonitor.source.intradayBars')
    case 'btc-derivatives': return t('marketMonitor.source.btcDerivatives')
    case 'tsla-reference': return t('marketMonitor.source.tslaReference')
    case 'tsla-calendar-news': return t('marketMonitor.source.tslaCalendarNews')
    case 'context': return t('marketMonitor.source.assetContext', { asset: asset ?? '' })
    default:
      if (source.id.endsWith('-reference') && equityAsset) return t('marketMonitor.source.equityReference', { asset: equityAsset })
      if (source.id.endsWith('-calendar-news') && equityAsset) return t('marketMonitor.source.equityCalendarNews', { asset: equityAsset })
      if (source.id.endsWith('-sec-filings') && equityAsset) return t('marketMonitor.source.secFilings', { asset: equityAsset })
      return source.label
  }
}

export function monitorSourceDetail(t: Translate, source: SourceHealth): string {
  const retained = source.detail.includes('retained') || source.detail.includes('Last valid fields')
  let detail: string
  if (source.id === 'daily-bars' || source.id === 'intraday-bars') {
    const stale = source.detail.match(/(\d+) weekday\(s\) behind/)
    const bars = source.detail.match(/(\d+) attributed bars/)
    const demo = source.detail.includes('Deterministic attributed')
    detail = `${source.detail.includes('fallback used') ? t('marketMonitor.source.fallbackUsed') : ''}${
      demo
        ? t(source.id === 'daily-bars' ? 'marketMonitor.source.demoBars' : 'marketMonitor.source.demoHourlyBars')
        : stale
          ? t('marketMonitor.source.staleDays', { count: Number(stale[1]) })
          : bars
            ? t('marketMonitor.source.attributedBars', { count: Number(bars[1]) })
            : source.status === 'unavailable'
              ? t('marketMonitor.source.unavailable')
              : source.status === 'degraded'
                ? t('marketMonitor.source.degraded')
                : t('marketMonitor.source.ok')
    }`
  } else if (source.id === 'btc-derivatives') {
    detail = source.status === 'unavailable'
      ? t('marketMonitor.source.unavailable')
      : `${t('marketMonitor.source.derivativesLoaded')}${source.detail.includes('futures unavailable') ? t('marketMonitor.source.futuresUnavailable') : ''}${source.detail.includes('options unavailable') ? t('marketMonitor.source.optionsUnavailable') : ''}`
  } else if (source.id.endsWith('-reference')) {
    detail = source.status === 'ok'
      ? t('marketMonitor.source.tslaFieldsLoaded')
      : t('marketMonitor.source.tslaFieldsUnavailable')
  } else if (source.id.endsWith('-calendar-news')) {
    const count = Number(source.detail.match(/; (\d+) recent/)?.[1] ?? 0)
    detail = `${source.detail.startsWith('Earnings date available') ? t('marketMonitor.source.earningsAvailable') : t('marketMonitor.source.noEarnings')}; ${t('marketMonitor.source.recentStories', { count })}${source.detail.includes('not configured') ? t('marketMonitor.source.newsNotConfigured') : ''}.`
  } else if (source.id.endsWith('-sec-filings')) {
    const count = Number(source.detail.match(/(\d+) recent material/)?.[1] ?? 0)
    detail = source.status === 'ok'
      ? t('marketMonitor.source.secFilingsLoaded', { count })
      : t('marketMonitor.source.unavailable')
  } else if (source.id === 'context' && source.detail.includes('Static context')) {
    detail = t('marketMonitor.source.demoContext')
  } else {
    detail = source.status === 'ok'
      ? t('marketMonitor.source.ok')
      : source.status === 'degraded'
        ? t('marketMonitor.source.degraded')
        : t('marketMonitor.source.unavailable')
  }
  return retained ? `${detail}${t('marketMonitor.source.retained')}` : detail
}

export function monitorAlertCopy(
  t: Translate,
  alert: MonitorAlert,
  snapshot: MonitorSnapshot | undefined,
): { title: string; message: string } {
  if (!snapshot) return { title: alert.title, message: alert.message }
  const hypothesis = monitorHypothesisCopy(t, snapshot)
  return {
    title: alert.title.includes('abnormal intraday')
      ? t('marketMonitor.history.abnormalConfirmation', { asset: alert.asset })
      : t('marketMonitor.history.stateChanged', { asset: alert.asset }),
    message: t('marketMonitor.history.alertMessage', {
      hypothesis: hypothesis.label,
      confidence: snapshot.hypothesis.confidence,
      note: monitorIntradayNote(t, snapshot),
    }),
  }
}
