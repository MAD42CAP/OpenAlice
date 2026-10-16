import { reviewSessionDate } from './review.js'
import { isOfficialEarningsSourceUrl } from './official-earnings.js'
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
  if (!isOfficialEarningsSourceUrl(snapshot.asset, event.sourceUrl ?? '')) return null
  return event
}
