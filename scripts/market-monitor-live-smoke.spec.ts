import { describe, expect, it } from 'vitest'
import { isLoopbackHost, parseOptions, runBackgroundProbe, validateHealthReport, validateScanPair, validateSnapshot } from './market-monitor-live-smoke.mjs'
import { summarizeMonitorHealth } from '../src/domain/market-monitor/health.js'

function snapshot(asset = 'BTC') {
  const intraday: Array<Record<string, unknown>> = []
  return {
    asset,
    strategyId: 'evidence-chain-v1',
    fingerprint: 'evidence-a',
    hypothesis: { id: 'balanced-range' },
    metrics: { lastPrice: 100 },
    chart: { daily: Array.from({ length: 20 }, () => ({})), intraday },
    sourceHealth: [
      { id: 'daily-bars', status: 'ok', provider: 'fixture' },
      { id: 'intraday-bars', status: 'unavailable', provider: 'fixture' },
    ],
  }
}

describe('market monitor live acceptance', () => {
  it('validates operational sample counts and preserves unavailable source checks', () => {
    const now = new Date('2026-09-13T00:00:00Z')
    const report = summarizeMonitorHealth('BTC', [{ id: '1', asset: 'BTC', requestedAt: now.toISOString(), trigger: 'manual', outcome: 'duplicate', sourceHealth: [{ id: 'context', label: 'Context', provider: 'fixture', status: 'unavailable', asOf: null }] }], 24, now)
    expect(() => validateHealthReport('BTC', report)).not.toThrow()
    expect(report.summary.scansWithSourceIssues).toBe(1)
    expect(() => validateHealthReport('TSLA', report)).toThrow('selection')
    expect(() => validateHealthReport('BTC', { ...report, summary: { ...report.summary, attempts: 0 } })).toThrow('counts')
  })
  it('defaults to a loopback, read-only acceptance run', () => {
    expect(parseOptions([], {})).toMatchObject({ baseUrl: 'http://127.0.0.1:47331', scan: false, background: false, assets: ['BTC', 'TSLA'] })
    expect(isLoopbackHost('::1')).toBe(true)
    expect(() => parseOptions(['--base-url=https://example.com'], {})).toThrow(/allow-remote/)
  })

  it('requires explicit background acceptance and restores settings on success or failure', async () => {
    const options = parseOptions(['--background', '--asset=TSLA'], {})
    const original = { backgroundEnabled: false, enabledAssets: ['BTC', 'TSLA'], intervalMinutes: 15 }
    for (const failed of [false, true]) {
      let current = original
      const methods: string[] = []
      const fetcher = async (url: string, init?: RequestInit) => {
        methods.push(init?.method ?? 'GET')
        if (url.endsWith('/settings')) {
          if (init?.method === 'PUT') current = JSON.parse(init.body as string)
          return new Response(JSON.stringify(current))
        }
        const receipts = current.backgroundEnabled ? [{ id: 'scheduled-1', asset: 'TSLA', trigger: 'scheduled', outcome: failed ? 'failed' : 'stored', error: failed ? 'offline' : undefined }] : []
        return new Response(JSON.stringify({ receipts }))
      }
      const probe = runBackgroundProbe(options, original, { fetcher })
      if (failed) await expect(probe).rejects.toThrow('offline')
      else expect(await probe).toMatchObject({ success: true })
      expect(current).toEqual(original)
      expect(methods).not.toContain('POST')
    }
  })

  it('never interrupts an already enabled schedule', async () => {
    await expect(runBackgroundProbe(parseOptions(['--background'], {}), { backgroundEnabled: true })).rejects.toThrow('Pause background monitoring')
  })

  it('restores settings after a timeout without dispatching scans', async () => {
    const original = { backgroundEnabled: false, enabledAssets: ['BTC'], intervalMinutes: 15 }
    let current = original
    let clock = 0
    const fetcher = async (url: string, init?: RequestInit) => {
      if (url.endsWith('/settings')) {
        if (init?.method === 'PUT') current = JSON.parse(init.body as string)
        return new Response(JSON.stringify(current))
      }
      return new Response(JSON.stringify({ receipts: [] }))
    }
    await expect(runBackgroundProbe(parseOptions(['--background', '--asset=BTC'], {}), original, {
      fetcher, now: () => clock, wait: async (ms: number) => { clock += ms },
    })).rejects.toThrow('within 150 seconds')
    expect(current).toEqual(original)
  })

  it('preserves settings changed by another operator during acceptance', async () => {
    const original = { backgroundEnabled: false, enabledAssets: ['BTC'], intervalMinutes: 15 }
    let current = original
    const fetcher = async (url: string, init?: RequestInit) => {
      if (url.endsWith('/settings')) {
        if (init?.method === 'PUT') current = JSON.parse(init.body as string)
        return new Response(JSON.stringify(current))
      }
      if (!current.backgroundEnabled) return new Response(JSON.stringify({ receipts: [] }))
      current = { ...current, intervalMinutes: 5 }
      return new Response(JSON.stringify({ receipts: [{ id: 'new', asset: 'BTC', trigger: 'scheduled', outcome: 'stored' }] }))
    }
    await expect(runBackgroundProbe(parseOptions(['--background', '--asset=BTC'], {}), original, { fetcher })).rejects.toThrow('preserved the newer settings')
    expect(current.intervalMinutes).toBe(5)
  })

  it('requires explicit and valid asset selection', () => {
    expect(parseOptions(['--', '--scan', '--asset=tsla'], {})).toMatchObject({ scan: true, assets: ['TSLA'] })
    expect(() => parseOptions(['--asset=ETH'], {})).toThrow(/BTC or TSLA/)
  })

  it('keeps an unavailable hourly source empty', () => {
    expect(() => validateSnapshot('BTC', snapshot())).not.toThrow()
    const invalid = snapshot()
    invalid.chart.intraday.push({})
    expect(() => validateSnapshot('BTC', invalid)).toThrow(/another timeframe/)
  })

  it('validates the selected strategy instead of hard-coding the first module', () => {
    const custom = { ...snapshot(), strategyId: 'custom-v1' }
    expect(() => validateSnapshot('BTC', custom, 'custom-v1')).not.toThrow()
    expect(() => validateSnapshot('BTC', custom)).toThrow(/strategy identity/)
  })

  it('rejects duplicate semantic observations and inconsistent receipts', () => {
    const first = { snapshot: snapshot(), stored: true, receipt: { asset: 'BTC', outcome: 'stored' } }
    const duplicate = { snapshot: snapshot(), stored: false, receipt: { asset: 'BTC', outcome: 'duplicate' } }
    expect(() => validateScanPair('BTC', first, duplicate)).not.toThrow()
    expect(() => validateScanPair('BTC', first, { ...duplicate, stored: true, receipt: { asset: 'BTC', outcome: 'stored' } })).toThrow(/duplicate observation/)
  })
})
