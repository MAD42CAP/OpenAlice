import { afterEach, expect, it, vi } from 'vitest'
import { FMPCalendarEarningsFetcher } from './calendar-earnings.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'

vi.mock('../../../core/provider/utils/helpers.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../core/provider/utils/helpers.js')>(), amakeRequest: vi.fn(),
}))
afterEach(() => vi.resetAllMocks())
const query = { start_date: '2026-10-01', end_date: '2026-10-16' }

it('keeps a successful empty calendar distinct from an upstream failure', async () => {
  vi.mocked(amakeRequest).mockResolvedValue([])
  await expect(FMPCalendarEarningsFetcher.extractData(query, null)).resolves.toEqual([])
})
it('does not disguise all failed intervals as a healthy empty calendar or expose keyed errors', async () => {
  vi.mocked(amakeRequest).mockRejectedValue(new Error('HTTP 403 https://example.test/?apikey=fixture-sensitive-value'))
  await expect(FMPCalendarEarningsFetcher.extractData(query, null)).rejects.toThrow('Earnings calendar unavailable: 2/2 intervals failed (HTTP 403)')
  try { await FMPCalendarEarningsFetcher.extractData(query, null) } catch (error) { expect(String(error)).not.toMatch(/apikey|fixture-sensitive|example\.test/) }
})
it('rejects incomplete and malformed responses instead of pretending the date range is covered', async () => {
  vi.mocked(amakeRequest).mockResolvedValueOnce([{ date: '2026-10-02', symbol: 'OTHER' }]).mockRejectedValueOnce(new Error('network failure'))
  await expect(FMPCalendarEarningsFetcher.extractData(query, null)).rejects.toThrow('1/2 intervals failed')
  vi.mocked(amakeRequest).mockResolvedValue({ unexpected: true })
  await expect(FMPCalendarEarningsFetcher.extractData(query, null)).rejects.toThrow('invalid response')
})
