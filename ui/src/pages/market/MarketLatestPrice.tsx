import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MonitorAsset } from '../../api/market-monitor'
import { useMarketQuote } from '../../hooks/useMarketQuote'
import { Button } from '../../components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible'
import { cn } from '../../lib/utils'
import { getIntlLocale } from '../../lib/intl'
import { formatMonitorDate } from './market-monitor-format'

export function MarketLatestPrice({ asset, visible, onViewResearch }: { asset: MonitorAsset; visible: boolean; onViewResearch?: () => void }) {
  const { t } = useTranslation()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const { quote, loading, failed, attempts, refresh } = useMarketQuote(asset, visible)
  const maxAge = quote?.provider === 'yfinance' && asset !== 'BTC' ? 20 * 60_000 : 2 * 60_000
  const expired = quote?.asOf != null && Date.now() - Date.parse(quote.asOf) > maxAge
  const status = failed ? 'unavailable' : expired ? 'stale' : quote?.status ?? 'unavailable'
  return <section aria-label={t('marketMonitor.quote.title', { asset })} className="oa-data-surface px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1"><h3 className="text-xs font-medium text-muted-foreground">{t('marketMonitor.quote.title', { asset })}</h3>
        <p className="text-2xl font-semibold tabular-nums">{quote?.price != null ? new Intl.NumberFormat(getIntlLocale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(quote.price) : '—'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" size="sm" disabled={loading} onClick={refresh}><RefreshCw className="size-3.5" aria-hidden />{t(loading ? 'marketMonitor.quote.loading' : 'marketMonitor.quote.refresh')}</Button></div>
    </div>
    {(status !== 'fresh' || loading && !quote) && <p role="status" className={cn('mt-1 text-xs leading-5', status === 'fresh' ? 'text-muted-foreground' : 'text-warning')}>{loading && !quote ? t('marketMonitor.quote.loading') : t(`marketMonitor.quote.${status}`)}{failed && quote?.price != null && ` ${t('marketMonitor.quote.retained')}`}</p>}
    {attempts.some(attempt => attempt.failure) && <p className="mt-1 text-[11px] text-warning">{attempts.flatMap(attempt => attempt.failure ? [`${attempt.provider}: ${t(`marketMonitor.quote.failures.${attempt.failure}`)}`] : []).join('；')}</p>}
    {quote?.illustrative && <p className="mt-1 text-xs text-warning">{t('marketMonitor.research.illustrative')}</p>}
    <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="mt-1">
      <div className="flex flex-wrap items-center gap-x-3 text-xs leading-5 text-muted-foreground">
        {quote && <span>{quote.feed ?? '—'} · {formatMonitorDate(quote.asOf)}{quote.feed === 'IEX' && ` · ${t('marketMonitor.quote.iexCompact')}`}</span>}
        <CollapsibleTrigger className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">{t('marketMonitor.quote.details')}</CollapsibleTrigger>
      </div>
      <CollapsibleContent>{detailsOpen && <div className="space-y-2 pt-1 text-xs text-muted-foreground">
        {quote && <p>{t('marketMonitor.quote.fetchedAt', { time: formatMonitorDate(quote.fetchedAt) })}</p>}
        <p>{t('marketMonitor.quote.basis')}{quote?.feed === 'IEX' && ` ${t('marketMonitor.quote.iex')}`}</p>
        <a href="#market-research" onClick={onViewResearch} className="text-primary hover:underline">{t('marketMonitor.quote.research')}</a>
      </div>}</CollapsibleContent>
    </Collapsible>
  </section>
}
