import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MarketIntelligenceReport, ResearchImport } from '../../api/market-intelligence'
import { RESEARCH_SECTION_KEYS, type EvidenceReference } from '../../api/market-intelligence-types'
import type { IntelligenceAction } from '../../hooks/useMarketIntelligence'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { formatMonitorDate } from './market-monitor-format'
import { IntelligenceClaimView, IntelligenceDisclosure, IntelligenceEvidence, IntelligenceSources, sourceUrl, formatResearchDate } from './MarketIntelligenceShared'

export function MarketResearchIntelligence({ report, busy, perform }: { report: MarketIntelligenceReport | null; busy: boolean; perform: (action: IntelligenceAction, input?: ResearchImport, force?: boolean) => Promise<boolean> }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [manual, setManual] = useState(false)
  const id = useId()
  const latest = report?.research.latest ?? null
  const snapshot = selected ? report?.research.snapshots.find(row => row.id === selected) ?? null : latest
  const imported = [...(report?.research.reports ?? [])].sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt))
  const evidence: EvidenceReference[] = [...new Map((report?.research.snapshots ?? []).flatMap(row => row.evidence).map(row => [row.id, row])).values()]
  const quality = snapshot && snapshot.evidence.length ? snapshot.evidence.some(row => row.quality !== 'available') || !snapshot.dataAsOf || snapshot.uncertainties.length > 0 || snapshot.metrics.some(row => row.value === null || !row.dataAsOf) ? 'partial' : 'complete' : 'unavailable'
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const input: ResearchImport = manual ? { url: url.trim(), title: title.trim(), text: text.trim(), ...(date ? { publishedAt: date } : {}) } : { url: url.trim() }
    await perform('import', input)
  }
  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} aria-busy={busy} onClick={() => void perform('discover', undefined, true)}>{t('intelligence.discover')}</Button><Button size="sm" disabled={busy || !imported.length} aria-busy={busy} onClick={() => void perform('run', undefined, true)}>{t('intelligence.reanalyze')}</Button></div>
    {report?.research.status.lastError && <p role="alert" className="border-l-2 border-warning px-3 py-2 text-xs text-warning">{report.research.status.lastError}</p>}
    {snapshot ? <section aria-label={t('intelligence.research')} className="oa-data-surface min-w-0 space-y-3 p-4">
      <p className="text-xs font-medium text-muted-foreground">{t(selected && selected !== latest?.id ? 'intelligence.historical' : 'intelligence.current')}</p>
      <div className="space-y-1"><h3 className="text-base font-semibold leading-6">{snapshot.reportTitle}</h3><div className="flex flex-wrap gap-x-3 text-[11px] leading-5 text-muted-foreground"><span>{t('intelligence.published', { time: snapshot.publicationTime ? formatMonitorDate(snapshot.publicationTime) : t('intelligence.unknown') })}</span><span>{t('intelligence.dataAsOf', { time: snapshot.dataAsOf ? formatResearchDate(snapshot.dataAsOf) : t('intelligence.unknown') })}</span><span>{t('intelligence.analysed', { time: formatMonitorDate(snapshot.analysisTime) })}</span><span>{t('intelligence.revision', { number: snapshot.revision })}</span></div><p className="text-[11px] text-muted-foreground">{t('intelligence.quality', { quality: t(`intelligence.qualities.${quality}`) })} · {snapshot.analysisModel ?? snapshot.provenance.agent}</p>{sourceUrl(snapshot.reportUrl) && <a href={sourceUrl(snapshot.reportUrl)} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2">{t('intelligence.origin')}</a>}</div>
      <IntelligenceClaimView claim={snapshot.mainThesis} evidence={evidence} showEvidence={false} />
      <IntelligenceDisclosure title={t('intelligence.details')}>
        {RESEARCH_SECTION_KEYS.map(key => <section key={key} className="space-y-2"><h4 className="text-sm font-medium">{t(`intelligence.sections.${key}`)}</h4>{snapshot.sections[key].length ? snapshot.sections[key].map((claim, index) => <IntelligenceClaimView key={index} claim={claim} evidence={evidence} />) : <p className="text-xs text-muted-foreground">{t('intelligence.unknown')}</p>}</section>)}
        <section className="space-y-3"><h4 className="text-sm font-medium">{t('intelligence.metrics')}</h4>{snapshot.metrics.map((metric, index) => <div key={index} className="border-l border-border pl-3"><p className="text-sm font-medium">{metric.name} · {metric.value == null ? '—' : String(metric.value)} {metric.unit}</p><p className="text-[11px] text-muted-foreground">{t(`intelligence.metricKind.${metric.kind}`)} · {t('intelligence.dataAsOf', { time: metric.dataAsOf ? formatResearchDate(metric.dataAsOf) : t('intelligence.unknown') })}</p><IntelligenceEvidence ids={metric.evidenceIds} evidence={evidence} /><IntelligenceClaimView claim={metric.meaning} evidence={evidence} />{metric.change && <IntelligenceClaimView claim={metric.change} evidence={evidence} />}</div>)}</section>
      </IntelligenceDisclosure>
      <IntelligenceDisclosure title={t('intelligence.weekly')} summary={snapshot.weeklyChanges[0]?.text ?? t('intelligence.noWeekly')}>
        {snapshot.weeklyChanges.map((change, index) => <section key={index} className="space-y-1"><h4 className="text-xs font-medium">{change.topic}</h4><p className="text-sm leading-6">{change.text}{change.inference && <span className="ml-2 text-xs text-muted-foreground">{t('intelligence.inference')}</span>}</p><p className="text-[11px] text-muted-foreground">{t('intelligence.currentEvidence')}</p><IntelligenceEvidence ids={change.currentEvidenceIds} evidence={evidence} /><p className="text-[11px] text-muted-foreground">{t('intelligence.previousEvidence')}</p><IntelligenceEvidence ids={change.previousEvidenceIds} evidence={evidence} /></section>)}
      </IntelligenceDisclosure>
      <IntelligenceSources evidence={snapshot.evidence} />
    </section> : <div className="space-y-2 py-5"><h3 className="text-base font-semibold">{imported[0]?.title ?? t('intelligence.noReport')}</h3>{imported[0] && <><p className="text-xs text-muted-foreground">{t('intelligence.pending')} · {t('intelligence.published', { time: imported[0].publishedAt ? formatMonitorDate(imported[0].publishedAt) : t('intelligence.unknown') })}</p>{sourceUrl(imported[0].url) && <a href={sourceUrl(imported[0].url)} target="_blank" rel="noreferrer" className="text-xs underline">{t('intelligence.origin')}</a>}</>}<p className="text-sm leading-6 text-muted-foreground">{t('intelligence.noResearch')}</p></div>}
    <IntelligenceDisclosure title={t('intelligence.researchHistory')} summary={`${imported.length}`}>
      <div className="space-y-2"><Button size="sm" variant="ghost" onClick={() => setSelected(null)}>{t('intelligence.current')}</Button>{imported.map(row => <section key={row.id} className="space-y-1 border-t border-border py-2"><p className="text-sm font-medium">{row.title}</p><p className="text-[11px] text-muted-foreground">{t('intelligence.published', { time: row.publishedAt ? formatMonitorDate(row.publishedAt) : t('intelligence.unknown') })} · {t('intelligence.retrieved', { time: formatMonitorDate(row.retrievedAt) })}</p>{sourceUrl(row.url) && <a className="text-xs underline" href={sourceUrl(row.url)} target="_blank" rel="noreferrer">{t('intelligence.origin')}</a>}<div className="flex flex-wrap gap-2">{report?.research.snapshots.filter(item => item.reportId === row.id).map(item => <Button key={item.id} size="sm" variant="outline" aria-pressed={snapshot?.id === item.id} onClick={() => setSelected(item.id)}>{formatMonitorDate(item.analysisTime)} · {t('intelligence.revision', { number: item.revision })}</Button>)}{!report?.research.snapshots.some(item => item.reportId === row.id) && <p className="text-xs text-muted-foreground">{t('intelligence.pending')}</p>}</div></section>)}</div>
    </IntelligenceDisclosure>
    <IntelligenceDisclosure title={t('intelligence.importTitle')} summary={t('intelligence.importSummary')} preserveContents>
      <form onSubmit={event => void submit(event)} className="space-y-3">
        <label htmlFor={`${id}-url`} className="block space-y-1 text-xs"><span>{t('intelligence.url')}</span><input id={`${id}-url`} type="url" required value={url} onChange={event => setUrl(event.target.value)} className="oa-field-control w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-2 text-sm" /></label>
        <Button type="button" variant="ghost" size="sm" aria-pressed={manual} onClick={() => setManual(value => !value)}>{t('intelligence.manual')}</Button>
        {manual && <><label htmlFor={`${id}-title`} className="block space-y-1 text-xs"><span>{t('intelligence.title')}</span><input id={`${id}-title`} required maxLength={400} value={title} onChange={event => setTitle(event.target.value)} className="oa-field-control w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-sm" /></label><label htmlFor={`${id}-text`} className="block space-y-1 text-xs"><span>{t('intelligence.text')}</span><Textarea id={`${id}-text`} required value={text} onChange={event => setText(event.target.value)} className="max-h-72 overflow-y-auto" /></label><label htmlFor={`${id}-date`} className="block space-y-1 text-xs"><span>{t('intelligence.date')}</span><input id={`${id}-date`} type="date" value={date} onChange={event => setDate(event.target.value)} className="oa-field-control max-w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-sm" /></label></>}
        <Button type="submit" size="sm" disabled={busy || !url.trim() || manual && (!title.trim() || !text.trim())} aria-busy={busy}>{t(manual ? 'intelligence.importText' : 'intelligence.importUrl')}</Button>
      </form>
    </IntelligenceDisclosure>
  </div>
}
