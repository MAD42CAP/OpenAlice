import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MonitorAsset } from '../../api/market-monitor'
import { useMarketQuote } from '../../hooks/useMarketQuote'
import { Button } from '../../components/ui/button'
import { getIntlLocale } from '../../lib/intl'
import { formatMonitorDate } from './market-monitor-format'

export function MarketLatestPrice({ asset, visible }: { asset: MonitorAsset; visible: boolean }) {
  const { t } = useTranslation()
  const { quote, loading, failed, attempts, refresh } = useMarketQuote(asset, visible)
  const maxAge = quote?.provider === 'yfinance' && asset !== 'BTC' ? 20 * 60_000 : 2 * 60_000
  const expired = quote?.asOf != null && Date.now() - Date.parse(quote.asOf) > maxAge
  const status = failed ? 'unavailable' : expired ? 'stale' : quote?.status ?? 'unavailable'
  return <section aria-label={t('marketMonitor.quote.title', { asset })} className="oa-data-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-xs font-medium text-muted-foreground">{t('marketMonitor.quote.title', { asset })}</h3>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{quote?.price != null ? new Intl.NumberFormat(getIntlLocale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(quote.price) : '—'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3"><a href="#market-research" className="text-xs text-primary hover:underline">{t('marketMonitor.quote.research')}</a><Button variant="secondary" size="sm" disabled={loading} onClick={refresh}><RefreshCw className="size-3.5" aria-hidden />{t(loading ? 'marketMonitor.quote.loading' : 'marketMonitor.quote.refresh')}</Button></div>
    </div>
    <p role="status" className="mt-2 text-xs leading-5 text-muted-foreground">{loading && !quote ? t('marketMonitor.quote.loading') : t(`marketMonitor.quote.${status}`)}{failed && quote?.price != null && ` ${t('marketMonitor.quote.retained')}`}</p>
    {quote && <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{quote.feed ?? '—'} · {t('marketMonitor.quote.tradeAt', { time: formatMonitorDate(quote.asOf) })} · {t('marketMonitor.quote.fetchedAt', { time: formatMonitorDate(quote.fetchedAt) })}</p>}
    {attempts.some(attempt => attempt.failure) && <p className="mt-1 text-[11px] text-warning">{attempts.flatMap(attempt => attempt.failure ? [`${attempt.provider}: ${t(`marketMonitor.quote.failures.${attempt.failure}`)}`] : []).join('；')}</p>}
    {quote?.illustrative && <p className="mt-1 text-xs text-warning">{t('marketMonitor.research.illustrative')}</p>}
    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{t('marketMonitor.quote.basis')}{quote?.feed === 'IEX' && ` ${t('marketMonitor.quote.iex')}`}</p>
  </section>
}
