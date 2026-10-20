import { http, HttpResponse } from 'msw'
import type { MonitorAsset } from '../../api/market-monitor'
import type { MovementCreate, MovementPlan } from '../../api/market-movement-alerts'
import { demoMovementReport } from '../fixtures/movement-alerts'
const assets = ['BTC', 'TSLA', 'MSTR'] as const
const plans: Record<MonitorAsset, MovementPlan[]> = { BTC: [], TSLA: [], MSTR: [] }
const validAsset = (value: unknown): value is MonitorAsset => assets.includes(value as MonitorAsset)
const failure = (error: string, status = 400) => HttpResponse.json({ error }, { status })
export const movementAlertHandlers = [
  http.get('/api/market-monitor/movement-alerts', ({ request }) => {
    const asset = new URL(request.url).searchParams.get('asset')
    if (!validAsset(asset)) return failure('movement-invalid')
    return HttpResponse.json(demoMovementReport(asset, plans[asset]))
  }),
  http.post('/api/market-monitor/movement-alerts', async ({ request }) => {
    const body = await request.json().catch(() => null) as MovementCreate | null
    if (!body || !validAsset(body.asset) || Object.keys(body).some(key => !['asset', 'upPercent', 'downPercent', 'expiresInHours'].includes(key))
      || !Number.isInteger(body.expiresInHours) || body.expiresInHours < 1 || body.expiresInHours > 168
      || body.upPercent === undefined && body.downPercent === undefined
      || [body.upPercent, body.downPercent].some(value => value !== undefined && (!Number.isFinite(value) || value < .1 || value > 50))) return failure('movement-invalid')
    const asset = body.asset, report = demoMovementReport(asset), at = report.generatedAt
    if (plans[asset].some(plan => Date.parse(plan.expiresAt) > Date.parse(at) && [plan.up, plan.down].some(leg => leg?.state === 'armed'))) return failure('movement-active-plan', 409)
    const anchor = report.risk.reference!
    plans[asset].unshift({ id: crypto.randomUUID(), asset, createdAt: at, expiresAt: new Date(Date.parse(at) + body.expiresInHours * 3_600_000).toISOString(), anchor,
      up: body.upPercent === undefined ? null : { state: 'armed', percent: body.upPercent, targetPrice: anchor.price * (1 + body.upPercent / 100), event: null },
      down: body.downPercent === undefined ? null : { state: 'armed', percent: body.downPercent, targetPrice: anchor.price * (1 - body.downPercent / 100), event: null }, lastObservedAsOf: null, latestCheck: null })
    return HttpResponse.json(demoMovementReport(asset, plans[asset]))
  }),
  http.post('/api/market-monitor/movement-alerts/:id/cancel', async ({ request, params }) => {
    const body = await request.json().catch(() => null) as { asset?: MonitorAsset } | null
    if (!body || !validAsset(body.asset)) return failure('movement-invalid')
    const plan = plans[body.asset].find(row => row.id === params.id)
    if (!plan) return failure('movement-not-found', 404)
    for (const leg of [plan.up, plan.down]) if (leg?.state === 'armed') leg.state = 'cancelled'
    return HttpResponse.json(demoMovementReport(body.asset, plans[body.asset]))
  }),
]
