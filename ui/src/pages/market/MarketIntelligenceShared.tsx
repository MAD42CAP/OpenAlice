import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { EvidenceReference, IntelligenceClaim } from '../../api/market-intelligence-types'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible'
import { cn } from '../../lib/utils'
import { formatMonitorDate } from './market-monitor-format'

export function IntelligenceDisclosure({ title, summary, children, preserveContents = false, warning = false }: { title: string; summary?: string; children: ReactNode; preserveContents?: boolean; warning?: boolean }) {
  const [open, setOpen] = useState(false)
  const [visited, setVisited] = useState(false)
  return <Collapsible open={open} onOpenChange={value => { setOpen(value); if (value) setVisited(true) }} className="min-w-0 border-t border-border">
    <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-3 py-3 text-left" aria-label={title}>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span>{summary && <span className={cn('mt-1 block text-xs leading-5', warning ? 'text-warning' : 'text-muted-foreground')}>{summary}</span>}</span>
      <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
    </CollapsibleTrigger>
    <CollapsibleContent keepMounted={preserveContents && visited} aria-hidden={!open} inert={!open}>{(open || preserveContents && visited) && <div className="min-w-0 space-y-4 pb-4 [overflow-wrap:anywhere]">{children}</div>}</CollapsibleContent>
  </Collapsible>
}

export function sourceUrl(value: string | null) {
  if (!value) return undefined
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined } catch { return undefined }
}

/** Research calendar dates have no time of day. Preserve the source day rather than inventing a local instant. */
export function formatResearchDate(value: string | null | undefined) {
  return value && /T00:00:00(?:\.000)?Z$/.test(value) ? value.slice(0, 10) : formatMonitorDate(value)
}

export function IntelligenceEvidence({ ids, evidence }: { ids: string[]; evidence: EvidenceReference[] }) {
  const { t } = useTranslation()
  const rows = ids.map(id => evidence.find(row => row.id === id)).filter((row): row is EvidenceReference => !!row)
  return rows.length ? <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">{rows.map(row => {
    const label = `${row.sourceName} · ${row.metric} · ${t('intelligence.dataAsOf', { time: row.dataAsOf ? row.reportId !== null ? formatResearchDate(row.dataAsOf) : formatMonitorDate(row.dataAsOf) : t('intelligence.unknown') })}`
    return sourceUrl(row.sourceUrl) ? <a key={row.id} href={sourceUrl(row.sourceUrl)} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-2 hover:text-foreground">{label}</a> : <span key={row.id}>{label}</span>
  })}</span> : <span className="mt-1 block text-[11px] text-warning">{t('intelligence.noEvidence')}</span>
}

export function IntelligenceClaimView({ claim, evidence, showEvidence = true }: { claim: IntelligenceClaim; evidence: EvidenceReference[]; showEvidence?: boolean }) {
  const { t } = useTranslation()
  return <div className="min-w-0 text-sm leading-6"><p>{claim.text}{claim.inference && <span className="ml-2 text-[11px] text-muted-foreground">{t('intelligence.inference')}</span>}</p>{showEvidence && <IntelligenceEvidence ids={claim.evidenceIds} evidence={evidence} />}</div>
}

export function IntelligenceClaims({ title, claims, evidence }: { title: string; claims: IntelligenceClaim[]; evidence: EvidenceReference[] }) {
  if (!claims.length) return null
  return <section className="min-w-0 space-y-2"><h4 className="text-xs font-medium text-muted-foreground">{title}</h4>{claims.map((claim, index) => <IntelligenceClaimView key={index} claim={claim} evidence={evidence} />)}</section>
}

export function IntelligenceSources({ evidence }: { evidence: EvidenceReference[] }) {
  const { t } = useTranslation()
  return <IntelligenceDisclosure title={t('intelligence.evidence')} summary={`${evidence.length}`}>
    <ul aria-label={t('intelligence.evidence')} className="divide-y divide-border text-xs leading-5">{evidence.map(row => <li key={row.id} className="min-w-0 space-y-1 py-2"><p>{row.sourceName} · {row.metric} · {row.value == null ? '—' : String(row.value)} {row.unit}</p><p className="text-muted-foreground">{t(`intelligence.metricKind.${row.kind}`)} · {t(`intelligence.qualities.${row.quality}`)}</p><p className="text-muted-foreground">{t('intelligence.dataAsOf', { time: row.dataAsOf ? row.reportId !== null ? formatResearchDate(row.dataAsOf) : formatMonitorDate(row.dataAsOf) : t('intelligence.unknown') })} · {t('intelligence.retrieved', { time: formatMonitorDate(row.retrievedAt) })}</p>{row.publishedAt && <p className="text-muted-foreground">{t('intelligence.published', { time: formatMonitorDate(row.publishedAt) })}</p>}{sourceUrl(row.sourceUrl) && <a href={sourceUrl(row.sourceUrl)} target="_blank" rel="noreferrer" className="underline underline-offset-2">{t('intelligence.origin')}</a>}</li>)}</ul>
  </IntelligenceDisclosure>
}
