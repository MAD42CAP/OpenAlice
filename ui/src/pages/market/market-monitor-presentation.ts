import type { TFunction } from 'i18next'
import type { EvidenceItem, MonitorAlert, MonitorSnapshot, SourceHealth } from '../../api/market-monitor'

type Translate = TFunction<'translation'>
type FormatNumber = (value: unknown, digits?: number) => string

export function monitorStrategyLabel(t: Translate, id: string, fallback: string): string {
  return id === 'evidence-chain-v1' ? t('marketMonitor.strategyEvidenceChain') : fallback
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
  switch (source.id) {
    case 'daily-bars': return t('marketMonitor.source.dailyBars')
    case 'intraday-bars': return t('marketMonitor.source.intradayBars')
    case 'btc-derivatives': return t('marketMonitor.source.btcDerivatives')
    case 'tsla-reference': return t('marketMonitor.source.tslaReference')
    case 'tsla-calendar-news': return t('marketMonitor.source.tslaCalendarNews')
    case 'context': return t('marketMonitor.source.assetContext', { asset: asset ?? '' })
    default: return source.label
  }
}

export function monitorSourceDetail(t: Translate, source: SourceHealth): string {
  const retained = source.detail.includes('retained') || source.detail.includes('Last valid fields')
  let detail: string
  if (source.id === 'daily-bars' || source.id === 'intraday-bars') {
    const stale = source.detail.match(/(\d+) weekday\(s\) behind/)
    const bars = source.detail.match(/(\d+) attributed bars/)
    const demo = source.detail.includes('Deterministic attributed')
    detail = `${source.detail.includes('Yahoo fallback') ? t('marketMonitor.source.fallbackUsed') : ''}${
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
  } else if (source.id === 'tsla-reference') {
    detail = source.status === 'ok'
      ? t('marketMonitor.source.tslaFieldsLoaded')
      : t('marketMonitor.source.tslaFieldsUnavailable')
  } else if (source.id === 'tsla-calendar-news') {
    const count = Number(source.detail.match(/; (\d+) recent/)?.[1] ?? 0)
    detail = `${source.detail.startsWith('Earnings date available') ? t('marketMonitor.source.earningsAvailable') : t('marketMonitor.source.noEarnings')}; ${t('marketMonitor.source.recentStories', { count })}${source.detail.includes('not configured') ? t('marketMonitor.source.newsNotConfigured') : ''}.`
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
