// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MarketDataPage } from './MarketDataPage'

const mocks = vi.hoisted(() => ({
  hubStatus: vi.fn(),
  testProvider: vi.fn(),
  updateConfig: vi.fn(),
  updateConfigImmediate: vi.fn(),
  retry: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    marketData: {
      hubStatus: mocks.hubStatus,
      testProvider: mocks.testProvider,
    },
  },
}))

vi.mock('../hooks/useConfigPage', () => ({
  useConfigPage: () => ({
    config: {
      enabled: true,
      hub: { enabled: false, baseUrl: 'https://traderhub.openalice.ai' },
      extraVendors: [],
      providerKeys: {
        alpacaKeyId: 'test-alpaca-id',
        alpacaSecretKey: 'test-alpaca-secret',
        coinbaseKeyName: 'organizations/test/apiKeys/key-id',
        coinbasePrivateKey: '-----BEGIN EC PRIVATE KEY-----\ntest\n-----END EC PRIVATE KEY-----',
        fmp: 'test-fmp-key',
        fred: 'test-fred-key',
        bls: 'test-bls-key',
        eia: 'test-eia-key',
        econdb: 'test-econdb-key',
        intrinio: 'test-intrinio-key',
      },
    },
    status: 'idle',
    loadError: false,
    updateConfig: mocks.updateConfig,
    updateConfigImmediate: mocks.updateConfigImmediate,
    retry: mocks.retry,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.testProvider.mockResolvedValue({ ok: true })
})

afterEach(cleanup)

function openProviderKeys() {
  render(<MarketDataPage />)
  fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))
}

describe('MarketDataPage provider credentials', () => {
  it('gives every key field and test action a provider-specific name', () => {
    openProviderKeys()

    for (const provider of ['FMP', 'FRED', 'BLS', 'EIA', 'EconDB', 'Intrinio']) {
      const input = screen.getByLabelText(`${provider} API key`)
      expect(screen.getByText(provider, { selector: 'label' }).getAttribute('for'))
        .toBe(input.getAttribute('id'))
      expect(input.getAttribute('aria-describedby')).toBe(
        `market-data-provider-${provider.toLowerCase()}-key-description ` +
        `market-data-provider-${provider.toLowerCase()}-key-hint ` +
        `market-data-provider-${provider.toLowerCase()}-key-test-status`,
      )
      expect(screen.getByRole('button', { name: `Test ${provider} key` })).toBeTruthy()
    }
  })

  it('keeps Alpaca market-data credentials paired and tests them together', async () => {
    openProviderKeys()
    expect(screen.getByLabelText('API Key ID')).toBeTruthy()
    expect(screen.getByLabelText('Secret Key')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Test Alpaca key' }))
    expect(await screen.findByRole('button', { name: 'Alpaca key test passed' })).toBeTruthy()
    expect(mocks.testProvider).toHaveBeenCalledWith('alpaca', 'test-alpaca-id', 'test-alpaca-secret')
  })

  it('keeps Coinbase CDP credentials paired and tests them together', async () => {
    openProviderKeys()
    expect(screen.getByLabelText('CDP API Key Name')).toBeTruthy()
    expect(screen.getByLabelText('ECDSA Private Key')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Test Coinbase key' }))
    expect(await screen.findByRole('button', { name: 'Coinbase key test passed' })).toBeTruthy()
    expect(screen.getByText('BTC-USD daily and hourly candles verified.')).toBeTruthy()
    expect(mocks.testProvider).toHaveBeenCalledWith(
      'coinbase',
      'organizations/test/apiKeys/key-id',
      '-----BEGIN EC PRIVATE KEY-----\ntest\n-----END EC PRIVATE KEY-----',
    )
  })

  it('shows the failing Coinbase candle interval and diagnostic', async () => {
    mocks.testProvider.mockResolvedValueOnce({ ok: false, error: 'Coinbase BTC-USD 1h candle test failed: No usable OHLC candles returned.' })
    openProviderKeys()
    fireEvent.click(screen.getByRole('button', { name: 'Test Coinbase key' }))
    expect(await screen.findByText(/1h candle test failed/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Coinbase key test failed' })).toBeTruthy()
  })

  it('clears a passed Coinbase result when either credential field changes', async () => {
    openProviderKeys()
    fireEvent.click(screen.getByRole('button', { name: 'Test Coinbase key' }))
    await screen.findByText('BTC-USD daily and hourly candles verified.')
    fireEvent.change(screen.getByLabelText('ECDSA Private Key'), { target: { value: 'replacement-test-value' } })
    expect(screen.queryByText('BTC-USD daily and hourly candles verified.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Test Coinbase key' })).toBeTruthy()
  })

  it('associates provider test progress and success with the matching field', async () => {
    let finishTest: ((result: { ok: boolean }) => void) | undefined
    mocks.testProvider.mockReturnValueOnce(new Promise((resolve) => {
      finishTest = resolve
    }))
    openProviderKeys()

    fireEvent.click(screen.getByRole('button', { name: 'Test FMP key' }))

    expect(await screen.findByRole('button', { name: 'Testing FMP key' })).toBeTruthy()
    expect(screen.getByText('Testing FMP key').getAttribute('id'))
      .toBe('market-data-provider-fmp-key-test-status')

    finishTest?.({ ok: true })

    expect(await screen.findByRole('button', { name: 'FMP key test passed' })).toBeTruthy()
    expect(screen.getByText('FMP key test passed').getAttribute('id'))
      .toBe('market-data-provider-fmp-key-test-status')
  })

  it('announces a failed provider test without changing another provider action', async () => {
    mocks.testProvider.mockResolvedValueOnce({ ok: false })
    openProviderKeys()

    fireEvent.click(screen.getByRole('button', { name: 'Test BLS key' }))

    expect(await screen.findByRole('button', { name: 'BLS key test failed' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Test FRED key' })).toBeTruthy()
  })
})
