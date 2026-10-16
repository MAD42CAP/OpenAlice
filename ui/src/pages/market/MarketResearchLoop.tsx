import { useTranslation } from 'react-i18next'
import type { MonitorAsset } from '../../api/market-monitor'
import { researchLoopProtocol, type ResearchLoopReport, type ResearchSource } from '../../api/research-loop-types'
import { useResearchLoop } from '../../hooks/useResearchLoop'
import { Button } from '../../components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible'
import { formatMonitorDate } from './market-monitor-format'

const sources: ResearchSource[] = ['prediction', 'jev', 'quant']
export function MarketResearchLoop(props: { asset: MonitorAsset; visible: boolean; revisionKey: string }) {
  const model = useResearchLoop(props.asset, props.visible, props.revisionKey)
  return <MarketResearchLoopView {...model} />
}
export function MarketResearchLoopView({ report, loading, error, running, refresh, run }: {
  report: ResearchLoopReport | null; loading: boolean; error: 'read' | 'run' | null; running: boolean
  refresh: () => void; run: () => void
}) {
  const { t } = useTranslation()
  const usable = !error && !loading && report && report.protocol === researchLoopProtocol(report.asset) ? report : null
  const count = sources.filter(source => usable?.contributors.some(row => row.source === source && row.state === 'ready')).length
  const consumed = Boolean(usable && usable.context.evidence.length > 0 && usable.context.hash && usable.synthesis?.contextHash === usable.context.hash)
  const busy = running || Boolean(usable?.contributors.some(row => row.state === 'running'))
  return <section aria-label={t('researchLoop.title')} className="min-w-0 border-t border-border py-3">
    <div role="status" aria-live="polite" className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs leading-5">
      <h2 className="font-medium">{t('researchLoop.title')}</h2>
      {loading ? <span className="text-muted-foreground">{t('researchLoop.loading')}</span> : !error && usable ? <>
        <span className="text-muted-foreground">{t('researchLoop.availability', { count })}</span>
        <span className="text-muted-foreground">{t(consumed ? 'researchLoop.included' : 'researchLoop.pending')}</span>
      </> : null}
    </div>
    {error && <p role="alert" className="mt-1 text-xs leading-5 text-warning">{t(error === 'run' ? 'researchLoop.runError' : 'researchLoop.readError')}</p>}
    {usable?.illustrative && <p className="mt-1 text-xs text-warning">{t('researchLoop.demo')}</p>}
    <Collapsible className="mt-1">
      <CollapsibleTrigger className="cursor-pointer rounded py-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">{t('researchLoop.details')}</CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-1">
        <p className="text-xs leading-5 text-muted-foreground">{t('researchLoop.scope')}</p>
        {sources.map(source => {
          const row = usable?.contributors.find(item => item.source === source)
          return <div key={source} className="min-w-0 border-l border-border pl-3 text-xs leading-5">
            <p className="font-medium">{t(`researchLoop.sources.${source}`)} · {t(`researchLoop.states.${row?.state ?? 'waiting'}`)}</p>
            {row?.summary && <p className="break-words text-muted-foreground">{row.summary}</p>}
            <p className="text-muted-foreground">{row?.updatedAt ? t('researchLoop.updated', { time: formatMonitorDate(row.updatedAt) }) : t('researchLoop.noTime')}</p>
          </div>
        })}
        {Boolean(usable?.invalidRecords) && <p className="text-xs text-warning">{t('researchLoop.invalid', { count: usable!.invalidRecords })}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={run} disabled={loading || busy} aria-busy={busy}>{t(busy ? 'researchLoop.running' : 'researchLoop.run')}</Button>
          {error && <Button size="sm" variant="ghost" onClick={refresh}>{t('researchLoop.retry')}</Button>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  </section>
}
