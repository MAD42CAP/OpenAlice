import { demoMonitorReview } from '../fixtures/market-review'
import { http, HttpResponse } from 'msw'
import type { MonitorAlert, MonitorAsset, MonitorSettings } from '../../api/market-monitor'
import { demoMonitorHealth, demoMonitorSnapshot } from '../fixtures/market-monitor'

const ASSETS: MonitorAsset[] = ['BTC', 'TSLA', 'MSTR']
let settings: MonitorSettings = { backgroundEnabled: false, codexNarrationEnabled: true, enabledAssets: ASSETS, strategyId: 'evidence-chain-v1', intervalMinutes: 15, notifications: false, alertConfidence: 68, abnormalVolumeRatio: 1.8, abnormalMovePercent: 1.5 }
const snapshots: Record<MonitorAsset, ReturnType<typeof demoMonitorSnapshot>[]> = { BTC: [demoMonitorSnapshot('BTC')], TSLA: [demoMonitorSnapshot('TSLA')], MSTR: [demoMonitorSnapshot('MSTR')] }
const alerts: MonitorAlert[] = []

export const marketMonitorHandlers = [
  http.get('/api/market-monitor/review', ({ request }) => {
    const query = new URL(request.url).searchParams
    const asset = query.get('asset'), days = query.get('days') ?? '30'
    if (!ASSETS.includes(asset as MonitorAsset) || !['7', '30', '90'].includes(days)) return HttpResponse.json({ error: 'Invalid review selection' }, { status: 400 })
    return HttpResponse.json(demoMonitorReview(asset as MonitorAsset, Number(days) as 7 | 30 | 90))
  }),
  // Demo fixtures predate input archives; never manufacture a successful replay.
  http.get('/api/market-monitor/snapshots/:id/replay', ({ params }) => HttpResponse.json({ status: 'unavailable', snapshotId: params.id })),
  http.get('/api/market-monitor/health', ({ request }) => {
    const params = new URL(request.url).searchParams
    const asset = params.get('asset')
    const hours = params.get('hours') ?? '24'
    if (!ASSETS.includes(asset as MonitorAsset) || !['24', '72'].includes(hours)) return HttpResponse.json({ error: 'Invalid report selection' }, { status: 400 })
    return HttpResponse.json(demoMonitorHealth(asset as MonitorAsset, Number(hours) as 24 | 72))
  }),
  http.get('/api/market-monitor/status', () => HttpResponse.json({
    running: false, backgroundEnabled: settings.backgroundEnabled, intervalMinutes: settings.intervalMinutes,
    checkedAt: null, error: null,
    assets: ASSETS.map((asset) => ({ asset, enabled: settings.enabledAssets.includes(asset), scanning: false, scanStartedAt: null, nextScanAt: null, lastReceipt: null, lastError: null })),
  })),
  http.get('/api/market-monitor/settings', () => HttpResponse.json(settings)),
  http.get('/api/market-monitor/narrator/status', () => HttpResponse.json({ enabled: settings.codexNarrationEnabled, state: settings.codexNarrationEnabled ? 'ready' : 'disabled', issueId: 'mad42lab-market-daily-interpretation', schedule: { cron: '30 17 * * *', timezone: 'America/Vancouver', localTime: '17:30' }, message: 'Demo schedule' })),
  http.post('/api/market-monitor/narrator/reconcile', () => HttpResponse.json({ enabled: settings.codexNarrationEnabled, state: settings.codexNarrationEnabled ? 'ready' : 'disabled', issueId: 'mad42lab-market-daily-interpretation', schedule: { cron: '30 17 * * *', timezone: 'America/Vancouver', localTime: '17:30' }, message: 'Demo schedule' })),
  http.post('/api/market-monitor/narrator/run', () => HttpResponse.json({ enabled: true, state: 'ready', issueId: 'mad42lab-market-daily-interpretation', schedule: { cron: '30 17 * * *', timezone: 'America/Vancouver', localTime: '17:30' }, message: 'Demo run dispatched' })),
  http.get('/api/market-monitor/strategies', () => HttpResponse.json({ strategies: [{ id: 'evidence-chain-v1', label: 'Evidence chain', version: 1, description: 'Location, structure, effort/result and confirmation.', requiredData: ['daily-bars', 'hourly-bars', 'asset-context'] }] })),
  http.get('/api/market-monitor/context-providers', () => HttpResponse.json({ providers: [
    { id: 'deribit-btc-v1', label: 'BTC derivatives', assets: ['BTC'], description: 'Deterministic Deribit context.' },
    { id: 'openalice-equity-v1', label: 'Equity reference', assets: ['TSLA', 'MSTR'], description: 'Deterministic OpenAlice reference context.' },
  ] })),
  http.put('/api/market-monitor/settings', async ({ request }) => {
    settings = await request.json() as MonitorSettings
    return HttpResponse.json(settings)
  }),
  http.post('/api/market-monitor/scan', async ({ request }) => {
    const body = await request.json() as { asset: MonitorAsset; trigger: 'manual' | 'scheduled' }
    const previous = snapshots[body.asset].at(-1)!
    return HttpResponse.json({ snapshot: previous, stored: false, alert: null, receipt: { id: `demo-receipt-${Date.now()}`, asset: body.asset, requestedAt: new Date().toISOString(), trigger: body.trigger, outcome: 'duplicate', snapshotId: previous.id } })
  }),
  http.get('/api/market-monitor/snapshots', ({ request }) => {
    const asset = new URL(request.url).searchParams.get('asset') as MonitorAsset | null
    const rows = asset ? snapshots[asset] : ASSETS.flatMap((item) => snapshots[item])
    return HttpResponse.json({ snapshots: rows, count: rows.length })
  }),
  http.get('/api/market-monitor/alerts', () => HttpResponse.json({ alerts, count: alerts.length })),
  http.get('/api/market-monitor/receipts', () => HttpResponse.json({ receipts: [], count: 0 })),
  http.get('/api/market-monitor/evaluation', ({ request }) => {
    const asset = (new URL(request.url).searchParams.get('asset') ?? 'BTC') as MonitorAsset
    return HttpResponse.json({ asset, samples: 1, resolved: 0, directionalAccuracy: null, averageForwardChangePercent: null, rows: [{ capturedAt: snapshots[asset][0].capturedAt, hypothesis: snapshots[asset][0].hypothesis.bias, confidence: snapshots[asset][0].hypothesis.confidence, nextCapturedAt: null, forwardChangePercent: null, correct: null }] })
  }),
]
