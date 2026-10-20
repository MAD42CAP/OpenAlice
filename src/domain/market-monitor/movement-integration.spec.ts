import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BarService, OhlcvBar } from '../market-data/bars/index.js'
import type { MarketQuote } from '../market-data/quotes.js'
import type { EquityClientLike } from '../market-data/client/types.js'
import type { ReferenceDataService } from '../market-data/reference/types.js'
import { MarketContextProviderRegistry } from './context.js'
import { createMovementAlertService } from './movement-alerts.js'
import { buildMovementRisk } from './movement-risk.js'
import { createMarketMonitorService } from './service.js'
import { createMarketMonitorStore } from './store.js'

describe('movement alerts on the normal monitor scan path', () => {
  it('triggers an independent rule on an unchanged analysis and retains it across restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'movement-scan-'))
    try {
      let at = new Date('2026-10-19T12:00:00Z')
      let price = 100
      const sourceTime = new Date(at.getTime())
      const series = (count: number, step: number): OhlcvBar[] => Array.from({ length: count }, (_, index) => ({
        date: new Date(sourceTime.getTime() - (count - index) * step).toISOString(),
        open: 100 + index, high: 102 + index, low: 99 + index, close: 101 + index, volume: 1000 + index,
      }))
      const daily = series(90, 86_400_000), hourly = series(48, 3_600_000)
      const store = createMarketMonitorStore(join(root, 'market'))
      const quotes = { read: async (): Promise<MarketQuote> => ({
        asset: 'BTC', price, currency: 'USD', asOf: at.toISOString(), fetchedAt: at.toISOString(),
        provider: 'coinbase', feed: 'Coinbase Exchange', status: 'fresh', attempts: [{ provider: 'coinbase' }],
      }) }
      const alertOptions = {
        quotes, root: join(root, 'alerts'), now: () => at,
        snapshot: async () => (await store.snapshots('BTC', 1)).at(-1) ?? null,
        risk: async (_asset: 'BTC' | 'TSLA' | 'MSTR', anchor: import('./movement-alert-types.js').MovementPrice | null) => buildMovementRisk(null, anchor, at),
      }
      const alerts = createMovementAlertService(alertOptions)
      const monitor = createMarketMonitorService({
        store, now: () => at, contextProviderRegistry: new MarketContextProviderRegistry([{
          manifest: { id: 'fixture', label: 'Fixture context', assets: ['BTC'], description: 'Isolated empty market context' },
          load: async () => ({ context: {}, health: [] }),
        }]), dashboardReaders: {},
        afterSnapshot: async snapshot => { await alerts.check(snapshot.asset) },
        equityClient: {} as EquityClientLike, reference: {} as ReferenceDataService,
        barService: { getBars: async (_id: string, options: { interval: string }) => {
          const rows = options.interval === '1h' ? hourly : daily
          return { bars: rows, meta: { symbol: 'BTC-USD', interval: options.interval, source: 'vendor',
            sourceId: 'coinbase', provider: 'coinbase', from: rows[0]!.date, to: rows.at(-1)!.date, bars: rows.length } }
        } } as unknown as BarService,
      })
      expect((await monitor.scan('BTC', 'scheduled')).stored).toBe(true)
      const plan = (await alerts.create({ asset: 'BTC', upPercent: 3, downPercent: 3, expiresInHours: 24 })).plans[0]!
      expect(plan.anchor.price).toBe(100)
      at = new Date('2026-10-19T12:01:00Z')
      price = 104
      const scan = await monitor.scan('BTC', 'scheduled')
      expect(scan.receipt.outcome).toBe('duplicate')
      const triggered = (await alerts.report('BTC')).plans.find(row => row.id === plan.id)!
      expect(triggered.up).toMatchObject({ state: 'triggered', event: { price: 104, direction: 'up' } })
      expect(triggered.down?.state).toBe('armed')
      const eventId = triggered.up!.event!.id
      const reopened = createMovementAlertService(alertOptions)
      at = new Date('2026-10-19T12:02:00Z')
      price = 105
      await reopened.check('BTC')
      expect((await reopened.report('BTC')).plans.find(row => row.id === plan.id)!.up!.event!.id).toBe(eventId)
      expect((await store.receipts('BTC')).every(receipt => receipt.outcome !== 'failed')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
