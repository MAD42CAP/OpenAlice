// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MarketLatestPrice } from './MarketLatestPrice'
import { i18n } from '../../i18n'

const mock = vi.hoisted(() => ({ hook: vi.fn(), refresh: vi.fn() }))
vi.mock('../../hooks/useMarketQuote', () => ({ useMarketQuote: mock.hook }))
// Component tests exercise labels separately from the hook's network lifecycle.
beforeEach(async () => {
  await i18n.changeLanguage('en')
  mock.hook.mockReturnValue({ quote: { price: 81123.45, asOf: '2026-09-18T19:00:00Z', fetchedAt: '2026-09-18T19:00:01Z', feed: 'Coinbase Exchange', status: 'fresh' }, loading: false, failed: false, attempts: [], refresh: mock.refresh })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('shows a separate attributed last trade and refresh/jump controls', () => {
  render(<MarketLatestPrice asset="BTC" visible />)
  expect(screen.getByRole('region', { name: 'BTC latest trade' })).toBeTruthy()
  expect(screen.getByText(/81,123.45/)).toBeTruthy()
  expect(screen.getByText(/Coinbase Exchange/)).toBeTruthy()
  expect(screen.getByText(/analysis still use closed bars/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh price' }))
  expect(mock.refresh).toHaveBeenCalledOnce()
  expect(screen.getByRole('link', { name: 'View research charts' }).getAttribute('href')).toBe('#market-research')
})
it('does not label a retained failed-refresh price as current', () => {
  mock.hook.mockReturnValue({ ...mock.hook(), failed: true })
  render(<MarketLatestPrice asset="BTC" visible />)
  expect(screen.getByRole('status').textContent).toContain('not current')
  expect(screen.queryByText('Latest trade quote')).toBeNull()
})

it('ages a retained quote while waiting for the next response', () => {
  mock.hook.mockReturnValue({ ...mock.hook(), quote: { ...mock.hook().quote, asOf: '2000-01-01T00:00:00Z' }, loading: true })
  render(<MarketLatestPrice asset="BTC" visible />)
  expect(screen.getByRole('status').textContent).toContain('last trade is older')
  expect(screen.queryByText('Latest trade quote')).toBeNull()
})
