import { useEffect, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MonitorAsset } from '../../api/market-monitor'
import { useMarketIntelligence } from '../../hooks/useMarketIntelligence'
import { Button } from '../../components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { cn } from '../../lib/utils'
import { formatMonitorDate } from './market-monitor-format'
import { MarketResearchIntelligence } from './MarketResearchIntelligence'
import { MarketInvestmentIntelligence } from './MarketInvestmentIntelligence'

export function MarketIntelligenceWorkspace({ asset, visible, revisionKey, children }: { asset: MonitorAsset; visible: boolean; revisionKey: string; children: ReactNode }) {
  const { t } = useTranslation()
  const state = useMarketIntelligence(asset, visible, revisionKey)
  const [selection, setSelection] = useState({ asset, tab: 'market' })
  useEffect(() => setSelection({ asset, tab: 'market' }), [asset])
  const tab = selection.asset === asset ? selection.tab : 'market'
  const tabs = asset === 'BTC' ? ['market', 'research', 'investment'] as const : ['market', 'investment'] as const
  const busy = state.feedback?.state === 'running' || state.report?.job.state === 'queued' || state.report?.job.state === 'running'
  return <Tabs value={tab} onValueChange={value => setSelection({ asset, tab: String(value) })} className="mx-auto w-full max-w-[1080px] min-w-0 space-y-3">
    <TabsList activateOnFocus aria-label={t('intelligence.layers', { asset })} className={cn("grid w-full", asset === 'BTC' ? 'grid-cols-3' : 'grid-cols-2')}>
      {tabs.map(value => <TabsTrigger key={value} value={value} className="min-w-0 whitespace-normal px-1 text-xs sm:px-3 sm:text-sm">{t(`intelligence.${value}`)}</TabsTrigger>)}
    </TabsList>
    <TabsContent value="market" keepMounted aria-hidden={tab !== 'market'} inert={tab !== 'market'}>{children}</TabsContent>
    {tabs.filter(value => value !== 'market').map(value => <TabsContent key={value} value={value} keepMounted aria-hidden={tab !== value} inert={tab !== value} className="min-w-0 space-y-3 pb-8 [overflow-wrap:anywhere]">
      {state.report?.illustrative && <p role="note" className="border-l-2 border-warning px-3 py-2 text-xs text-warning">{t('intelligence.demo')}</p>}
      {state.error && <div role="alert" className="space-y-1 border-l-2 border-warning bg-warning/5 px-3 py-2 text-xs leading-5"><p>{t('intelligence.unavailable', { error: state.error })}</p>{state.report && <p>{t('intelligence.retained')}</p>}<Button size="sm" variant="ghost" onClick={state.refresh}>{t('intelligence.retry')}</Button></div>}
      {state.feedback && <p role={state.feedback.state === 'failed' ? 'alert' : 'status'} aria-live="polite" className={cn('border-l-2 px-3 py-2 text-xs leading-5', state.feedback.state === 'failed' || state.feedback.state === 'partial' ? 'border-warning text-warning' : 'border-primary')}>{t(`intelligence.feedback.${state.feedback.state}`, { action: t(`intelligence.actions.${state.feedback.action}`), error: state.feedback.error })}</p>}
      {state.loading && !state.report && <p role="status" className="text-sm text-muted-foreground">{t('intelligence.loading')}</p>}
      {state.report && <div role={state.report.job.state === 'failed' || state.report.job.state === 'blocked' ? 'alert' : 'status'} className={cn('flex min-w-0 flex-wrap items-start justify-between gap-2 border-b border-border pb-3 text-xs leading-5', ['failed', 'blocked', 'partial'].includes(state.report.job.state) && 'text-warning')}>
        <div className="min-w-0 flex-1"><p className="font-medium">{t('intelligence.job')} · {t(`intelligence.states.${state.report.job.state}`)}</p><p className="text-muted-foreground">{state.report.job.message}</p>{state.report.job.updatedAt && <p className="text-muted-foreground">{formatMonitorDate(state.report.job.updatedAt)}</p>}</div>
        <Button variant="ghost" size="sm" onClick={state.refresh} disabled={state.loading} aria-label={t('intelligence.refresh')}><RefreshCw aria-hidden className={cn('size-3.5', state.loading && 'animate-spin motion-reduce:animate-none')} /></Button>
      </div>}
      {value === 'research'
        ? <MarketResearchIntelligence report={state.report} busy={!!busy} perform={state.perform} />
        : <MarketInvestmentIntelligence key={asset} report={state.report} busy={!!busy} onRun={() => void state.perform('run', undefined, true)} />}
    </TabsContent>)}
  </Tabs>
}
