import { http, HttpResponse } from 'msw'
import { demoResearchLoop } from '../fixtures/research-loop'
export const researchLoopHandlers = [
  http.get('/api/market-monitor/research-loop', ({ request }) => {
    const url = new URL(request.url)
    if (url.searchParams.has('asset') && url.searchParams.get('asset') !== 'BTC') return HttpResponse.json({ error: 'BTC only' }, { status: 400 })
    return HttpResponse.json(demoResearchLoop(url.searchParams.get('scenario') === 'failed' ? 'failed' : 'ready'))
  }),
  http.post('/api/market-monitor/research-loop/run', async ({ request }) => {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return HttpResponse.json({ error: 'Expected an empty object' }, { status: 400 })
    return HttpResponse.json(demoResearchLoop())
  }),
]
