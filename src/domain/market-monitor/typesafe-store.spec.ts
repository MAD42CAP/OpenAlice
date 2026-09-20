import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir, platform } from 'node:os'
import { join } from 'node:path'
let home: string
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'oa-typesafe-')); vi.stubEnv('OPENALICE_HOME', home); vi.resetModules() })
afterEach(async () => { vi.unstubAllEnvs(); vi.resetModules(); await rm(home, { recursive: true, force: true }) })
describe('TypeSafe credential isolation', () => {
  it('seals credentials, exposes only presence, preserves blank and removes explicitly', async () => {
    const { createTypeSafeStore } = await import('./typesafe-store.js')
    const root = join(home, 'test'), store = createTypeSafeStore(root)
    expect(await store.settings()).toMatchObject({ configured: false, automatic: false })
    expect(await store.save({ apiKey: 'test-only-placeholder', automatic: true })).toMatchObject({ configured: true, automatic: true })
    const file = await readFile(join(root, 'settings.json'), 'utf8')
    expect(file).not.toContain('test-only-placeholder')
    expect(JSON.parse(file).$sealed).toBe(1)
    if (platform() !== 'win32') expect((await stat(join(root, 'settings.json'))).mode & 0o777).toBe(0o600)
    await store.save({ apiKey: '' })
    expect((await store.config()).apiKey).toBe('test-only-placeholder')
    expect(JSON.stringify(await store.settings())).not.toContain('test-only-placeholder')
    expect(await store.save({ clearKey: true })).toMatchObject({ configured: false, automatic: false })
  })
})
