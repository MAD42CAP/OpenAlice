import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MonitorAsset } from '../../api/market-monitor'
import { THESIS_METRICS, thesisMetricAllowed, type ThesisCondition, type ThesisDraft, type ThesisEvaluation, type ThesisReport, type ThesisRevision } from '../../api/market-thesis-types'
import { useMarketThesis } from '../../hooks/useMarketThesis'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible'
import { formatMonitorDate } from './market-monitor-format'

const control = 'oa-field-control w-full min-w-0 rounded-md border border-input bg-background px-2 py-2 text-sm'
const stamp = (value: string | null) => value ? value.length === 10 ? value : formatMonitorDate(value) : '—'
export function MarketThesisPanel(props: { asset: MonitorAsset; visible: boolean; revisionKey: string }) {
  const model = useMarketThesis(props.asset, props.visible, props.revisionKey)
  return <MarketThesisView key={props.asset} asset={props.asset} {...model} />
}

export function MarketThesisView({ asset, report, loading, busy, error, refresh, save, check }: {
  asset: MonitorAsset; report: ThesisReport | null; loading: boolean; busy: boolean; error: string | null
  refresh: () => void; save: (expected: number, draft: ThesisDraft) => Promise<boolean>; check: () => Promise<boolean>
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<ThesisRevision | null | undefined>(undefined)
  const revision = report?.revision, current = report?.current
  return <section aria-label={t('thesis.title')} className="oa-data-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{t('thesis.title')}</h2>
      <div className="flex flex-wrap gap-2">
        {revision?.enabled && <Button size="sm" variant="outline" disabled={busy} onClick={() => void check()}>{t('thesis.check')}</Button>}
        {report && editing === undefined && <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(revision ?? null)}>{t(revision ? 'thesis.edit' : 'thesis.create')}</Button>}
      </div>
    </div>
    {error && <div role="alert" className="mt-3 text-sm text-warning"><p>{t(`thesis.error.${error === 'thesis-conflict' || error === 'thesis-invalid' ? error : 'thesis-unavailable'}`)}</p><Button size="sm" variant="ghost" onClick={refresh}>{t('thesis.refresh')}</Button></div>}
    {!report && !error && <p role="status" className="mt-3 text-sm text-muted-foreground">{t(loading ? 'thesis.loading' : 'thesis.empty')}</p>}
    {report && !revision && <p className="mt-3 text-sm text-muted-foreground">{t('thesis.empty')}</p>}
    {revision && <>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{revision.thesis}</p>
      <p className="mt-1 text-xs text-muted-foreground">{revision.horizon} · {t('thesis.version', { version: revision.revision, time: stamp(revision.createdAt) })}</p>
      {!error && current && <div aria-live="polite" className="mt-3"><p className={current.status === 'triggered' ? 'font-semibold text-destructive' : current.status === 'incomplete' ? 'font-semibold text-warning' : 'font-semibold'}>{t(`thesis.status.${current.status}`)}</p><p className="mt-1 text-sm text-muted-foreground">{t('thesis.count', { supported: current.supported, triggered: current.triggered, unknown: current.unknown })}</p></div>}
      {!current && <p className="mt-3 text-sm text-muted-foreground">{t('thesis.noCheck')}</p>}
      {report.checkError && <p role="alert" className="mt-2 text-sm text-warning">{t('thesis.checkError')}</p>}
      {report.lastCheckedAt && <p className="mt-2 text-xs text-muted-foreground">{t('thesis.checked', { time: stamp(report.lastCheckedAt) })}</p>}
      {current && <Collapsible className="mt-3"><CollapsibleTrigger className="py-2 text-sm font-medium">{t('thesis.details')}</CollapsibleTrigger><CollapsibleContent><ThesisRows evaluation={current} /><p className="mt-3 text-xs leading-5 text-muted-foreground">{t('thesis.note')}</p></CollapsibleContent></Collapsible>}
      <ThesisHistory report={report} />
    </>}
    {editing !== undefined && <ThesisEditor asset={asset} initial={editing} busy={busy} cancel={() => setEditing(undefined)} save={async draft => { if (await save(editing?.revision ?? 0, draft)) setEditing(undefined) }} />}
    <p className="mt-3 text-xs leading-5 text-muted-foreground">{t('thesis.scope')}</p>
  </section>
}

function ThesisRows({ evaluation }: { evaluation: ThesisEvaluation }) {
  const { t } = useTranslation()
  return <div className="space-y-3">{evaluation.rows.map(({ condition: c, evidence: e, result }) => <div key={c.id} className="border-t border-border pt-3 text-sm">
    <div className="flex flex-wrap justify-between gap-2"><p className="min-w-0 break-words font-medium">{c.label}</p><p className={c.kind === 'invalidate' && result === 'met' ? 'text-destructive' : result === 'unknown' ? 'text-warning' : 'text-muted-foreground'}>{t(`thesis.result.${result}`)}</p></div>
    <p className="mt-1 text-xs text-muted-foreground">{t(c.kind === 'support' ? 'thesis.support' : 'thesis.invalidate')} · {t(`thesis.metrics.${c.metric}`)} {c.metric !== 'manual' && <>{({ gt: '>', gte: '≥', lt: '<', lte: '≤' })[c.operator]} {c.threshold}</>}</p>
    <p className="mt-2">{t('thesis.value')}：{e.value == null ? '—' : `${e.value.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${t(`thesis.units.${e.unit}`)}`} · {t(`thesis.reason.${e.reason}`)}</p>
    <p className="mt-1 break-words text-xs text-muted-foreground">{t('thesis.source')}：{e.provider ?? '—'} · {t('thesis.dataAt')}：{stamp(e.dataAt)} · {t('thesis.observedAt')}：{stamp(e.observedAt)}</p>
  </div>)}</div>
}

function ThesisHistory({ report }: { report: ThesisReport }) {
  const { t } = useTranslation()
  const [version, setVersion] = useState(''), [checkId, setCheckId] = useState('')
  const revision = report.revisions.find(r => String(r.revision) === version) ?? report.revisions.at(-1)
  const check = report.checks.find(c => c.recordHash === checkId) ?? report.checks.at(-1)
  return <Collapsible className="mt-2"><CollapsibleTrigger className="py-2 text-sm font-medium">{t('thesis.history')}</CollapsibleTrigger><CollapsibleContent className="space-y-3">
    <label className="block text-sm">{t('thesis.thesis')}<select className={control} value={revision?.revision ?? ''} onChange={e => setVersion(e.target.value)}>{report.revisions.slice().reverse().map(r => <option key={r.revision} value={r.revision}>{t('thesis.version', { version: r.revision, time: stamp(r.createdAt) })}</option>)}</select></label>
    {revision && <div className="space-y-1 whitespace-pre-wrap break-words text-sm"><p>{revision.thesis}</p><p className="text-muted-foreground">{revision.horizon} · {revision.changeNote}</p>{revision.conditions.map(c => <p key={c.id}>{t(c.kind === 'support' ? 'thesis.support' : 'thesis.invalidate')} · {c.label} · {t(`thesis.metrics.${c.metric}`)} {c.metric !== 'manual' && `${({ gt: '>', gte: '≥', lt: '<', lte: '≤' })[c.operator]} ${c.threshold}`}</p>)}</div>}
    {check ? <><label className="block text-sm">{t('thesis.archived')}<select className={control} value={check.recordHash} onChange={e => setCheckId(e.target.value)}>{report.checks.slice().reverse().map(c => <option key={c.recordHash} value={c.recordHash}>{t('thesis.version', { version: c.revision.revision, time: stamp(c.checkedAt) })}</option>)}</select></label><p className="text-sm">{check.revision.thesis}</p><p className="text-sm font-medium">{t(`thesis.status.${check.evaluation.status}`)}</p><ThesisRows evaluation={check.evaluation} /></> : <p className="text-sm">{t('thesis.noHistory')}</p>}
    {report.truncated && <p className="text-xs text-muted-foreground">{t('thesis.limited')}</p>}
  </CollapsibleContent></Collapsible>
}

function ThesisEditor({ asset, initial, busy, cancel, save }: { asset: MonitorAsset; initial: ThesisRevision | null; busy: boolean; cancel: () => void; save: (draft: ThesisDraft) => Promise<void> }) {
  const { t } = useTranslation()
  const condition = (): ThesisCondition => ({ id: crypto.randomUUID(), label: '', kind: 'support', metric: 'daily-close', operator: 'gte', threshold: null })
  const [draft, setDraft] = useState<ThesisDraft>(() => initial ? { ...initial, changeNote: '' } : { thesis: '', horizon: '', enabled: true, changeNote: '', conditions: [condition()] })
  const update = (index: number, patch: Partial<ThesisCondition>) => setDraft(d => ({ ...d, conditions: d.conditions.map((c, i) => i === index ? { ...c, ...patch } : c) }))
  return <form className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={e => { e.preventDefault(); const { thesis, horizon, enabled, changeNote, conditions } = draft; void save({ thesis, horizon, enabled, changeNote, conditions }) }}>
    <p className="text-xs text-muted-foreground">{t('thesis.draftHint')}</p>
    <label className="block text-sm">{t('thesis.thesis')}<Textarea required maxLength={2000} value={draft.thesis} placeholder={t('thesis.placeholder')} onChange={e => setDraft(d => ({ ...d, thesis: e.target.value }))} /></label>
    <label className="block text-sm">{t('thesis.horizon')}<input className={control} required maxLength={100} value={draft.horizon} placeholder={t('thesis.horizonPlaceholder')} onChange={e => setDraft(d => ({ ...d, horizon: e.target.value }))} /></label>
    {draft.conditions.map((c, index) => <fieldset key={c.id} className="min-w-0 space-y-2 border-t border-border pt-3"><legend className="text-sm font-medium">{t('thesis.condition')} {index + 1}</legend>
      <label className="block text-sm">{t('thesis.condition')}<input className={control} required maxLength={200} value={c.label} onChange={e => update(index, { label: e.target.value })} /></label>
      <div className="grid gap-2 sm:grid-cols-2"><label className="min-w-0 text-sm">{t('thesis.kind')}<select className={control} value={c.kind} onChange={e => update(index, { kind: e.target.value as ThesisCondition['kind'] })}><option value="support">{t('thesis.support')}</option><option value="invalidate">{t('thesis.invalidate')}</option></select></label>
      <label className="min-w-0 text-sm">{t('thesis.metric')}<select className={control} value={c.metric} onChange={e => update(index, { metric: e.target.value as ThesisCondition['metric'], threshold: null })}>{THESIS_METRICS.filter(m => thesisMetricAllowed(asset, m)).map(m => <option key={m} value={m}>{t(`thesis.metrics.${m}`)}</option>)}</select></label></div>
      {c.metric !== 'manual' && <div className="grid grid-cols-2 gap-2"><label className="text-sm">{t('thesis.operator')}<select className={control} value={c.operator} onChange={e => update(index, { operator: e.target.value as ThesisCondition['operator'] })}>{(['gt', 'gte', 'lt', 'lte'] as const).map(op => <option key={op} value={op}>{({ gt: '>', gte: '≥', lt: '<', lte: '≤' })[op]}</option>)}</select></label><label className="min-w-0 text-sm">{t('thesis.threshold')}<input className={control} required type="number" step="any" max={1e12} min={['daily-close', 'volume-ratio', 'put-call-ratio', 'strategy-mnav'].includes(c.metric) ? 0 : -1e12} value={c.threshold ?? ''} onChange={e => update(index, { threshold: e.target.value === '' ? null : Number(e.target.value) })} /></label></div>}
      <Button type="button" size="sm" variant="ghost" disabled={draft.conditions.length === 1 || busy} onClick={() => setDraft(d => ({ ...d, conditions: d.conditions.filter((_, i) => i !== index) }))}>{t('thesis.remove')}</Button>
    </fieldset>)}
    <Button type="button" size="sm" variant="outline" disabled={draft.conditions.length >= 12 || busy} onClick={() => setDraft(d => ({ ...d, conditions: [...d.conditions, condition()] }))}>{t('thesis.add')}</Button>
    <p className="text-xs leading-5 text-muted-foreground">{t('thesis.note')}</p>
    <label className="block text-sm">{t('thesis.changeNote')}<input className={control} required maxLength={300} value={draft.changeNote} placeholder={t('thesis.reasonPlaceholder')} onChange={e => setDraft(d => ({ ...d, changeNote: e.target.value }))} /></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))} />{t('thesis.enabled')}</label>
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>{t('thesis.save')}</Button><Button type="button" variant="ghost" disabled={busy} onClick={cancel}>{t('thesis.cancel')}</Button></div>
  </form>
}
