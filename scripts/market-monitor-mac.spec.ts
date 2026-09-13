import { expect, it } from 'vitest'
import {
  assessMacEnvironment,
  dashboardUrlFromLine,
  dashboardUrlFromStatus,
  isManageableBackgroundStatus,
  parseMacLauncherOptions,
  resolveMacRuntimePaths,
  versionAtLeast,
  waitForDashboard,
} from './market-monitor-mac.mjs'

it('parses safe Mac launch modes and rejects conflicting services', () => {
  expect(parseMacLauncherOptions(['--', '--check', '--no-open', '--home=./tmp'])).toMatchObject({ check: true, noOpen: true, home: expect.stringContaining('/tmp') })
  expect(parseMacLauncherOptions(['--status'])).toMatchObject({ status: true })
  expect(parseMacLauncherOptions(['--stop'])).toMatchObject({ stop: true })
  expect(() => parseMacLauncherOptions(['--demo', '--full'])).toThrow(/cannot be combined/)
  expect(() => parseMacLauncherOptions(['--status', '--open'])).toThrow(/cannot be combined/)
  expect(() => parseMacLauncherOptions(['--stop', '--full'])).toThrow(/lifecycle actions/)
  expect(() => parseMacLauncherOptions(['--takeover'])).toThrow(/unknown option/)
})

it('derives isolated background state and accepts only this checkout detached owner', () => {
  expect(resolveMacRuntimePaths({ home: null }, { homeDir: '/Users/alice', env: {} })).toEqual({
    home: '/Users/alice/.openalice',
    log: '/Users/alice/.openalice/state/market-monitor.log',
  })
  const status = {
    owner: { surface: 'dev', mode: 'detached', launchRoot: '/repo/OpenAlice' },
    control: { capabilities: ['runtime.status', 'runtime.stop'] },
    endpoints: { web: 'http://127.0.0.1:5184' },
  }
  expect(dashboardUrlFromStatus(status)).toBe('http://127.0.0.1:5184/market/evidence')
  expect(isManageableBackgroundStatus(status, '/repo/OpenAlice')).toBe(true)
  expect(isManageableBackgroundStatus({ ...status, owner: { ...status.owner, mode: 'foreground' } }, '/repo/OpenAlice')).toBe(false)
  expect(isManageableBackgroundStatus({ ...status, control: { capabilities: ['runtime.status'] } }, '/repo/OpenAlice')).toBe(false)
  expect(isManageableBackgroundStatus({ ...status, owner: { ...status.owner, surface: 'cli-server' } }, '/repo/OpenAlice')).toBe(false)
  expect(isManageableBackgroundStatus(status, '/repo/Another')).toBe(false)
  expect(dashboardUrlFromStatus({ endpoints: { web: 'https://example.com' } })).toBeNull()
})

it('requires the supported Mac toolchain and only warns about branch identity', () => {
  expect(versionAtLeast('v22.19.0', '22.19.0')).toBe(true)
  expect(versionAtLeast('v22.18.9', '22.19.0')).toBe(false)
  expect(assessMacEnvironment({ platform: 'darwin', nodeVersion: 'v22.19.0', pnpmVersion: '11.7.0', dependenciesInstalled: true, gitRepository: true, branch: 'another-branch' })).toMatchObject({ ok: true, warnings: [expect.stringContaining(EXPECTED_BRANCH_FOR_TEST)] })
  expect(assessMacEnvironment({ platform: 'linux', nodeVersion: 'v20.0.0', pnpmVersion: null, dependenciesInstalled: false, gitRepository: false, branch: null })).toMatchObject({ ok: false, errors: expect.arrayContaining([expect.stringContaining('macOS'), expect.stringContaining('Node.js'), expect.stringContaining('pnpm')]) })
  expect(assessMacEnvironment({ platform: 'darwin', nodeVersion: 'v22.19.0', pnpmVersion: '10.0.0', dependenciesInstalled: true, gitRepository: true, branch: EXPECTED_BRANCH_FOR_TEST })).toMatchObject({ ok: false, errors: [expect.stringContaining('pnpm 11.7.0')] })
})

const EXPECTED_BRANCH_FOR_TEST = 'feature/market-evidence-monitor'

it('extracts the Guardian-selected UI port and waits for the actual app shell', async () => {
  const line = '\u001b[32m[guardian] UI       →  http://localhost:5184\u001b[0m'
  expect(dashboardUrlFromLine(line)).toBe('http://localhost:5184/market/evidence')
  let attempts = 0
  const fetcher = async (url: string) => {
    expect(url).toBe('http://localhost:5184/market/evidence')
    attempts++
    return new Response(attempts === 2 ? '<div id="root"></div>' : 'starting', { status: attempts === 2 ? 200 : 503 })
  }
  expect(await waitForDashboard('http://localhost:5184/market/evidence', { fetcher, wait: async () => undefined, attempts: 3 })).toBe(true)
  expect(attempts).toBe(2)
})

it('does not report readiness for an unrelated local web page', async () => {
  expect(await waitForDashboard('http://localhost:5173/market/evidence', { fetcher: async () => new Response('<html>other service</html>'), wait: async () => undefined, attempts: 2 })).toBe(false)
})
