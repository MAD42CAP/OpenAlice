import { useTranslation } from 'react-i18next'
import type { MarketJudgmentReport } from '../../api/market-judgment'
import { useMarketIntelligenceRead } from './MarketIntelligenceContext'
import { investmentHasNoRestriction, investmentReasonKey } from './investment-explanation'
import { formatMonitorDate } from './market-monitor-format'

export function MarketStateSentence({ report, horizon, error }: { report: MarketJudgmentReport; horizon: 'short' | 'medium' | 'long'; error: boolean }) {
  const { t } = useTranslation()
  const shared = useMarketIntelligenceRead()
  const native = shared?.asset === report.asset && shared.report?.asset === report.asset ? shared.report : null
  const snapshot = native?.investment.latest
  const outlook = snapshot?.asset === report.asset ? snapshot.outlooks.find(row => row.horizon === horizon) : null
  const state = (h: 'short' | 'medium' | 'long') => {
    const row = report.horizons[h]
    if (row.reasons.includes('daily-missing') || h === 'short' && row.reasons.some(reason => reason === 'hourly-missing' || reason === 'hourly-policy-unverified')) return t('marketExplanation.technical.insufficient')
    if (row.reasons.includes('structure-conflict')) return t('marketExplanation.technical.conflict')
    if (row.direction === 'range') return t('marketExplanation.technical.sideways')
    return t(`marketExplanation.technical.${row.rules}`)
  }
  const technical = error ? t('marketExplanation.technicalUnavailable') : t('marketExplanation.technicalSentence', { asset: report.asset, short: state('short'), medium: state('medium'), long: state('long') })
  const label = t(`marketExplanation.horizons.${horizon}`)
  let ai = t('marketExplanation.aiUnknown')
  if (shared?.asset === report.asset && shared.error) ai = t('marketExplanation.aiReadError')
  else if (error) ai = t('marketExplanation.aiNotMerged')
  else if (snapshot && outlook) {
    const direction = t(`intelligence.directions.${outlook.direction}`)
    const reason = investmentReasonKey(native, snapshot, horizon)
    const unrestricted = investmentHasNoRestriction(native, snapshot, horizon)
    const view = reason ? t(outlook.direction === 'uncertain' ? 'marketExplanation.aiWithheld' : 'marketExplanation.aiDirectional', { horizon: label, direction, reason: t(reason) })
      : t(outlook.direction === 'uncertain' ? 'marketExplanation.aiReasonUnknown' : unrestricted ? 'marketExplanation.aiDirectionOnly' : 'marketExplanation.aiDirectionReasonUnknown', { horizon: label, direction })
    ai = snapshot.marketSnapshotId !== report.snapshotId ? t('marketExplanation.aiEarlier', { view, time: formatMonitorDate(snapshot.analysisTime) }) : view
  }
  return <p data-testid="market-state-sentence" className="text-base font-semibold leading-7 [overflow-wrap:anywhere]">{t('marketExplanation.sentence', { technical, ai })}</p>
}
