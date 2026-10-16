import { http, HttpResponse } from 'msw'
import type { MonitorAsset } from '../../api/market-monitor'
import { demoMarketIntelligence } from '../fixtures/market-intelligence'
const assetOf = (request: Request) => new URL(request.url).searchParams.get('asset') ?? 'BTC'
const validAsset = (asset: string): asset is MonitorAsset => ['BTC', 'TSLA', 'MSTR'].includes(asset)
export const marketIntelligenceHandlers = [
  http.get('/api/market-monitor/intelligence', ({ request }) => {
    const asset = assetOf(request)
    return validAsset(asset) ? HttpResponse.json(demoMarketIntelligence(asset)) : HttpResponse.json({ error: 'Unsupported asset' }, { status: 400 })
  }),
  ...['discover', 'import', 'run'].map(action => http.post(`/api/market-monitor/intelligence/${action}`, ({ request }) => {
    const asset = assetOf(request)
    if (!validAsset(asset) || (asset !== 'BTC' && action !== 'run')) return HttpResponse.json({ error: 'Unsupported asset for this action' }, { status: 400 })
    return HttpResponse.json(demoMarketIntelligence(asset))
  })),
]
