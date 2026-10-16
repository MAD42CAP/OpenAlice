import { http, HttpResponse } from 'msw'
import type { MonitorAsset } from '../../api/market-monitor'
import { demoResearchLoop } from '../fixtures/research-loop'
const assetOf = (request: Request) => new URL(request.url).searchParams.get('asset') ?? 'BTC'
const validAsset = (asset: string): asset is MonitorAsset => ['BTC', 'TSLA', 'MSTR'].includes(asset)
export const researchLoopHandlers = [
  http.get('/api/market-monitor/research-loop', ({ request }) => {
    const url = new URL(request.url), asset = assetOf(request)
    if (!validAsset(asset)) return HttpResponse.json({ error: 'Unsupported asset' }, { status: 400 })
    return HttpResponse.json(demoResearchLoop(url.searchParams.get('scenario') === 'failed' ? 'failed' : 'ready', asset))
  }),
  http.post('/api/market-monitor/research-loop/run', async ({ request }) => {
    const asset = assetOf(request)
    if (!validAsset(asset)) return HttpResponse.json({ error: 'Unsupported asset' }, { status: 400 })
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return HttpResponse.json({ error: 'Expected an empty object' }, { status: 400 })
    return HttpResponse.json(demoResearchLoop('ready', asset))
  }),
]
