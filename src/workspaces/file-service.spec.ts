import { chmod, lstat, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const control = vi.hoisted(() => ({
  content: null as string | null,
  started: null as (() => void) | null,
  release: null as Promise<void> | null,
  fail: false,
}))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
    const [path, data, options] = args
    if (typeof data !== 'string' || data !== control.content) return actual.writeFile(...args)
    // Hold an actual partial filesystem write open. A target-path writer
    // exposes this interval to readers; atomic publication must not.
    const middle = Math.floor(data.length / 2)
    await actual.writeFile(path, data.slice(0, middle), options)
    control.started?.()
    await control.release
    if (control.fail) throw Object.assign(new Error('synthetic write failure'), { code: 'EIO' })
    await actual.appendFile(path, data.slice(middle), 'utf8')
  } }
})
import { PathTraversal, readWorkspaceFile, writeWorkspaceFile, writeWorkspaceFileAtomically } from './file-service.js'

const roots: string[] = []
afterEach(async () => {
  control.content = null; control.started = null; control.release = null; control.fail = false
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'workspace-atomic-')); roots.push(dir); return dir }
function hold(content: string, fail = false) {
  let started!: () => void, release!: () => void
  const ready = new Promise<void>(resolve => { started = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  Object.assign(control, { content, fail, started, release: gate })
  return { ready, release }
}

describe('Workspace file publication', () => {
  it('keeps native configuration writes on the established Git-excluded target name', async () => {
    const dir = await fixture(), content = JSON.stringify({ fixture: 'synthetic native configuration' })
    const blocked = hold(content), pending = writeWorkspaceFile(dir, 'opencode.json', content)
    await blocked.ready
    try { expect(await readdir(dir)).toEqual(['opencode.json']) }
    finally { blocked.release(); await pending }
    expect(await readWorkspaceFile(dir, 'opencode.json')).toBe(content)
  })

  it('keeps the complete old file readable until the complete replacement is ready', async () => {
    const dir = await fixture(), previous = JSON.stringify({ version: 3, old: true })
    const content = JSON.stringify({ version: 3, value: 'new setting '.repeat(2000) })
    await writeWorkspaceFileAtomically(dir, 'settings.json', previous)
    await chmod(join(dir, 'settings.json'), 0o640)
    const blocked = hold(content), pending = writeWorkspaceFileAtomically(dir, 'settings.json', content)
    await blocked.ready
    try { expect(await readWorkspaceFile(dir, 'settings.json')).toBe(previous) }
    finally { blocked.release(); await pending }
    expect(await readWorkspaceFile(dir, 'settings.json')).toBe(content)
    expect((await stat(join(dir, 'settings.json'))).mode & 0o777).toBe(0o640)
    expect(await readdir(dir)).toEqual(['settings.json'])
  })
  it('preserves the old file and removes incomplete scratch data if a write fails', async () => {
    const dir = await fixture(), previous = 'existing complete data', content = 'failed replacement content'
    await writeWorkspaceFileAtomically(dir, 'settings.json', previous)
    const blocked = hold(content, true), pending = writeWorkspaceFileAtomically(dir, 'settings.json', content)
    const rejected = expect(pending).rejects.toThrow('synthetic write failure')
    await blocked.ready; blocked.release(); await rejected
    expect(await readWorkspaceFile(dir, 'settings.json')).toBe(previous)
    expect(await readdir(dir)).toEqual(['settings.json'])
  })
  it('replaces a symlink without altering its original target', async () => {
    const dir = await fixture(), target = join(dir, 'other.txt')
    await writeFile(target, 'original target', 'utf8')
    await symlink(target, join(dir, 'local.txt'))
    await writeWorkspaceFileAtomically(dir, 'local.txt', 'local replacement')
    expect((await lstat(join(dir, 'local.txt'))).isSymbolicLink()).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('original target')
    expect(await readWorkspaceFile(dir, 'local.txt')).toBe('local replacement')
  })
  it('publishes concurrent independent writers as whole documents and retains traversal guards', async () => {
    const dir = await fixture(), documents = Array.from({ length: 12 }, (_, id) => JSON.stringify({ id, payload: String(id).repeat(4096) }))
    await Promise.all(documents.map(content => writeWorkspaceFileAtomically(dir, 'settings.json', content)))
    expect(documents).toContain(await readWorkspaceFile(dir, 'settings.json'))
    expect(await readdir(dir)).toEqual(['settings.json'])
    await expect(writeWorkspaceFileAtomically(dir, '../outside.json', '{}')).rejects.toBeInstanceOf(PathTraversal)
  })
})
