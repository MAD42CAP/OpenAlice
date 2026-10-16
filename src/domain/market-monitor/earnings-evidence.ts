import { reviewSessionDate } from './review.js'
import type { MarketEarningsEvent, MarketMonitorSnapshot } from './types.js'

/** New event records carry their own source identity; unrelated news or SEC
 * outages cannot erase a verified announcement. Legacy archives stay legacy. */
export function currentOfficialEarnings(snapshot: MarketMonitorSnapshot, at: Date): MarketEarningsEvent | null {
  const event = snapshot.context.earningsEvent
  const source = snapshot.sourceHealth.find(s => s.id === `${snapshot.asset.toLowerCase()}-earnings`)
  if (!event || snapshot.asset === 'BTC' || event.asset !== snapshot.asset || event.status !== 'confirmed'
    || !event.date || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || !Number.isFinite(Date.parse(event.date))
    || new Date(event.date).toISOString().slice(0, 10) !== event.date || event.date < reviewSessionDate(snapshot.asset, at.toISOString())
    || snapshot.context.nextEarningsAt !== event.date || !source || source.status !== 'ok'
    || source.retained?.fields.some(f => f === 'nextEarningsAt' || f === 'earningsEvent')
    || source.failedFields?.some(f => f === 'nextEarningsAt' || f === 'earningsEvent')
    || !['live-official', 'research-reviewed'].includes(event.verification ?? '') || !event.contentHash || !/^[a-f0-9]{64}$/.test(event.contentHash)) return null
  const retrieved = Date.parse(event.retrievedAt), captured = Date.parse(snapshot.capturedAt)
  if (!Number.isFinite(retrieved) || !Number.isFinite(at.getTime()) || retrieved > at.getTime() || retrieved > captured
    || at.getTime() - retrieved > 86_400_000 || source.asOf !== event.retrievedAt
    || !event.publishedAt || !Number.isFinite(Date.parse(event.publishedAt)) || Date.parse(event.publishedAt) > retrieved) return null
  try {
    const url = new URL(event.sourceUrl ?? '')
    const allowed = snapshot.asset === 'TSLA' ? url.origin === 'https://ir.tesla.com' && url.pathname.startsWith('/press-release/')
      : url.origin === 'https://www.strategy.com' && url.pathname.startsWith('/press/')
    if (!allowed || url.username || url.password || url.search || url.hash) return null
  } catch { return null }
  return event
}
