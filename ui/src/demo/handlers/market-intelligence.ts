import { http, HttpResponse } from 'msw'
import { demoMarketIntelligence } from '../fixtures/market-intelligence'
export const marketIntelligenceHandlers = [
  http.get('/api/market-monitor/intelligence', () => HttpResponse.json(demoMarketIntelligence())),
  ...['discover', 'import', 'run'].map(action => http.post(`/api/market-monitor/intelligence/${action}`, () => HttpResponse.json(demoMarketIntelligence()))),
]
