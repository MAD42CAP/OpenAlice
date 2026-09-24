import { http, HttpResponse } from 'msw'
import type { MonitorAsset } from '../../api/market-monitor'
import type { ThesisDraft } from '../../api/market-thesis-types'
import { demoThesisReport } from '../fixtures/market-thesis'
const reports = { BTC: demoThesisReport('BTC'), TSLA: demoThesisReport('TSLA'), MSTR: demoThesisReport('MSTR') }
const valid = (asset: unknown): asset is MonitorAsset => ['BTC', 'TSLA', 'MSTR'].includes(String(asset))
export const marketThesisHandlers = [
  http.get('/api/market-monitor/thesis', ({ request }) => {
    const asset = new URL(request.url).searchParams.get('asset')
    return valid(asset) ? HttpResponse.json(reports[asset]) : HttpResponse.json({ error: 'Invalid asset' }, { status: 400 })
  }),
  http.put('/api/market-monitor/thesis', async ({ request }) => {
    const body = await request.json() as { asset: MonitorAsset; expectedRevision: number; draft: ThesisDraft }
    if (!valid(body.asset) || !body.draft?.conditions?.length || !body.draft.thesis || !body.draft.horizon || !body.draft.changeNote) return HttpResponse.json({ error: 'thesis-invalid' }, { status: 400 })
    if (reports[body.asset].revision?.revision !== body.expectedRevision) return HttpResponse.json({ error: 'thesis-conflict' }, { status: 409 })
    reports[body.asset] = demoThesisReport(body.asset, body.draft, reports[body.asset])
    return HttpResponse.json(reports[body.asset])
  }),
  http.post('/api/market-monitor/thesis/check', async ({ request }) => {
    const body = await request.json() as { asset: MonitorAsset }
    return valid(body.asset) ? HttpResponse.json(reports[body.asset]) : HttpResponse.json({ error: 'Invalid asset' }, { status: 400 })
  }),
]
