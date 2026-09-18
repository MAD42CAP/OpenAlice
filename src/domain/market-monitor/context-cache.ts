import type { MarketContext, SourceHealth } from './types.js'

/** Latest successful source observations, independent of analysis de-duplication. */
export type MarketContextCache = Array<{ id: string; provider: string; asOf: string; context: MarketContext }>

function fields(id: string): Array<keyof MarketContext> {
  if (id === 'btc-derivatives') return ['fundingRate', 'openInterest', 'annualizedBasisPercent', 'optionOpenInterest', 'putCallOpenInterestRatio']
  if (id.endsWith('-reference')) return ['marketCap', 'trailingPe', 'forwardPe', 'analystTargetMean', 'shortPercentFloat']
  if (id.endsWith('-sec-filings')) return ['recentFilings']
  if (id.endsWith('-calendar-news')) return ['nextEarningsAt', 'recentNews']
  return []
}

export function retainContext(current: MarketContext, health: SourceHealth[], previous: MarketContextCache, at: Date) {
  const context = { ...current }
  const cache = new Map(previous.map(row => [row.id, row]))
  const sources = health.map(source => {
    const keys = fields(source.id)
    if (source.status === 'ok' && source.asOf && Number.isFinite(Date.parse(source.asOf))) {
      cache.set(source.id, { id: source.id, provider: source.provider, asOf: source.asOf,
        context: Object.fromEntries(keys.map(key => [key, current[key]])) })
      return source
    }
    const prior = cache.get(source.id)
    const age = at.getTime() - Date.parse(prior?.asOf ?? '')
    // A normal 15-minute cadence also includes request time and poll delay.
    // This is display-only grace, never a renewal of source freshness.
    const ttl = source.id === 'btc-derivatives' ? 30 * 60_000 : 24 * 3_600_000
    if (!prior || prior.provider !== source.provider || !Number.isFinite(age) || age < 0 || age > ttl) return source
    const retained: Array<keyof MarketContext> = []
    for (const key of source.failedFields ?? keys) {
      if (keys.includes(key) && context[key] == null && prior.context[key] != null) {
        Object.assign(context, { [key]: prior.context[key] })
        retained.push(key)
      }
    }
    if (!retained.length) return source
    const expiresAt = new Date(Date.parse(prior.asOf) + ttl).toISOString()
    return { ...source, asOf: prior.asOf,
      retained: { asOf: prior.asOf, expiresAt, fields: retained },
      detail: `${source.detail} Last valid fields retained from ${prior.asOf}; display only until ${expiresAt}, not current confirmation. Failed scans do not renew this time.` }
  })
  return { context, health: sources, cache: [...cache.values()] }
}
