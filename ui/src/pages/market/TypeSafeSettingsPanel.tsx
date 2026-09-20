import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { inputClass } from '../../components/form'
import { useTypeSafeSettings } from '../../hooks/useTypeSafe'

export function TypeSafeSettingsPanel() {
  const { t } = useTranslation()
  const { settings, error, busy, save, test } = useTypeSafeSettings()
  const [key, setKey] = useState(''), [automatic, setAutomatic] = useState(false)
  const [message, setMessage] = useState<'saved' | 'tested' | 'demoTested' | null>(null)
  useEffect(() => { if (settings) setAutomatic(settings.automatic) }, [settings])
  return <section className="mx-auto mt-6 max-w-[1100px] rounded-xl border border-border bg-card p-5" aria-labelledby="typesafe-settings-title">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="typesafe-settings-title" className="text-sm font-semibold">{t('typesafe.title')}</h2>
      <span className="text-xs text-muted-foreground">{settings?.model ?? 'Jev'} · {t(settings?.illustrative ? 'typesafe.demo' : settings?.configured ? 'typesafe.configured' : 'typesafe.missing')}</span>
    </div>
    <p className="mt-2 text-sm text-muted-foreground">{t('typesafe.description')}</p>
    <form className="mt-4 space-y-4" onSubmit={async e => { e.preventDefault(); setMessage(null); if (await save({ apiKey: key, automatic })) { setKey(''); setMessage('saved') } }}>
      <div className="max-w-xl space-y-2">
        <label htmlFor="typesafe-api-key" className="block text-sm">{t('typesafe.key')}</label>
        <input id="typesafe-api-key" type="password" autoComplete="new-password" spellCheck={false} maxLength={4096} value={key} onChange={e => { setKey(e.target.value); setMessage(null) }} disabled={busy || !settings} className={inputClass} aria-describedby="typesafe-key-help" />
        <p id="typesafe-key-help" className="text-xs text-muted-foreground">{t('typesafe.keyHint')}</p>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={automatic} onChange={e => setAutomatic(e.target.checked)} disabled={busy || !settings || (!settings.configured && !key.trim())} className="mt-1" /><span>{t('typesafe.automatic')}<span className="mt-1 block text-xs text-muted-foreground">{t('typesafe.automaticHint')}</span></span></label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || !settings}>{t(busy ? 'typesafe.busy' : 'typesafe.save')}</Button>
        <Button type="button" size="sm" variant="outline" disabled={busy || !settings?.configured || Boolean(key)} onClick={async () => { setMessage(null); const result = await test(); if (result) setMessage(result === 'demo' ? 'demoTested' : 'tested') }}>{t('typesafe.test')}</Button>
        {settings?.configured && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={async () => { setMessage(null); if (await save({ clearKey: true })) { setKey(''); setMessage('saved') } }}>{t('typesafe.clear')}</Button>}
      </div>
      {message && <p role="status" className="text-sm text-muted-foreground">{t(`typesafe.${message}`)}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error === 'load' ? t('typesafe.loadError') : error}</p>}
    </form>
  </section>
}
