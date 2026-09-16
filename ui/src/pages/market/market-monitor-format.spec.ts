import { expect, it } from 'vitest'
import { formatContextValue, formatMonitorDate } from './market-monitor-format'
import { i18n } from '../../i18n'

it('preserves session dates and formats instants separately', () => {
  expect(formatMonitorDate('2026-09-16')).toBe('2026-09-16')
  expect(formatMonitorDate(null)).toBe('—')
  expect(formatMonitorDate('invalid')).toBe('invalid')
})

it('formats derivative and equity units without rounding funding to zero', async () => {
  await i18n.changeLanguage('en')
  expect(formatContextValue('fundingRate', 0.00007141)).toBe('0.007141%')
  expect(formatContextValue('shortPercentFloat', 0.021)).toBe('2.1%')
  expect(formatContextValue('annualizedBasisPercent', 7.68)).toBe('7.68%')
  expect(formatContextValue('openInterest', 790265750)).toBe('790,265,750 USD')
  expect(formatContextValue('optionOpenInterest', 433850.1)).toBe('433,850.1 BTC')
  expect(formatContextValue('fundingRate', null)).toBe('—')
})
