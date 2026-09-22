import { http, HttpResponse } from 'msw'
import { demoJevReport } from '../fixtures/typesafe'
import { demoForecastExperiment } from '../fixtures/forecast-experiment'
import type { MonitorAsset } from '../../api/market-monitor'
let settings = { configured: true, automatic: false, model: 'jev-1.13.0' }
export const typeSafeHandlers = [
  http.get('/api/market-monitor/forecast-experiment', ({ request }) => {
    const asset = new URL(request.url).searchParams.get('asset') as MonitorAsset
    if (!['BTC', 'TSLA', 'MSTR'].includes(asset)) return HttpResponse.json({ error: 'Invalid asset' }, { status: 400 })
    return HttpResponse.json({ ...demoForecastExperiment(asset), ...settings })
  }),
  http.post('/api/market-monitor/forecast-experiment', () => HttpResponse.json({ id: 'demo-comparison', issuedAt: new Date().toISOString() })),
  http.get('/api/market-monitor/typesafe/settings', () => HttpResponse.json({ ...settings, illustrative: true })),
  http.put('/api/market-monitor/typesafe/settings', async ({ request }) => {
    const input = await request.json() as { clearKey?: boolean; automatic?: boolean; apiKey?: string }
    // Never retain the submitted credential, including in browser storage.
    settings = { ...settings, configured: input.clearKey ? false : Boolean(input.apiKey) || settings.configured, automatic: input.clearKey ? false : input.automatic ?? settings.automatic }
    return HttpResponse.json({ ...settings, illustrative: true })
  }),
  http.post('/api/market-monitor/typesafe/test', () => HttpResponse.json({ model: settings.model, inputTokens: 0, illustrative: true })),
  http.get('/api/market-monitor/typesafe/report', ({ request }) => {
    const asset = new URL(request.url).searchParams.get('asset') as MonitorAsset
    if (!['BTC', 'TSLA', 'MSTR'].includes(asset)) return HttpResponse.json({ error: 'Invalid asset' }, { status: 400 })
    return HttpResponse.json({ ...demoJevReport(asset), ...settings })
  }),
  http.post('/api/market-monitor/typesafe/forecast', async ({ request }) => {
    const { asset } = await request.json() as { asset: MonitorAsset }
    return HttpResponse.json({ id: `demo-jev-${asset}`, issuedAt: new Date().toISOString(), model: settings.model })
  }),
  http.post('/api/market-monitor/typesafe/audit', async ({ request }) => {
    const input = await request.json() as { source: string; claim: string; sourceUrl?: string }
    return HttpResponse.json({ ...input, sourceUrl: input.sourceUrl ?? null, id: 'demo-audit', issuedAt: new Date().toISOString(), model: settings.model, inputTokens: 0, durationMs: 0,
      answers: { support: { type: 'choice', choice: 'insufficient', confidence: 1, probabilities: { supported: 0, contradicted: 0, insufficient: 1 } }, event: { type: 'choice', choice: 'unspecified', confidence: 1, probabilities: { planned: 0, completed: 0, cancelled: 0, unspecified: 1 } } } })
  }),
]
