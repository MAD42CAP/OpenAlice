import { getIntlLocale } from '../../lib/intl'

export function formatMonitorDate(value: string | null | undefined): string {
  if (!value) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(getIntlLocale())
}

export function formatContextValue(key: string, value: unknown): string {
  if (key.endsWith('At')) return formatMonitorDate(typeof value === 'string' ? value : null)
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const fraction = key === 'fundingRate' || key === 'shortPercentFloat'
  const formatted = new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: key === 'fundingRate' ? 6 : 2 }).format(fraction ? value * 100 : value)
  if (fraction || key === 'annualizedBasisPercent') return `${formatted}%`
  if (key === 'optionOpenInterest') return `${formatted} BTC`
  if (['openInterest', 'marketCap', 'analystTargetMean'].includes(key)) return `${formatted} USD`
  return formatted
}
