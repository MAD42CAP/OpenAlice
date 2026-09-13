import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { devGuardianOwnerMode, parseDevGuardianOptions } from './dev-options.js'

describe('parseDevGuardianOptions', () => {
  it('resolves a separate development home from the checkout directory', () => {
    expect(parseDevGuardianOptions(['--', '--home', '../openalice-homes/feature-a'], '/repo/OpenAlice'))
      .toEqual({ home: resolve('/repo/OpenAlice', '../openalice-homes/feature-a') })
  })

  it('supports equals syntax and leaves other Guardian options alone', () => {
    expect(parseDevGuardianOptions(['--takeover', '--home=/tmp/openalice feature']))
      .toEqual({ home: resolve('/tmp/openalice feature') })
  })

  it('uses the final home when a wrapper supplied more than one', () => {
    expect(parseDevGuardianOptions(['--home', '/tmp/first', '--home=/tmp/second']))
      .toEqual({ home: resolve('/tmp/second') })
  })

  it('rejects a missing home path before any process starts', () => {
    expect(() => parseDevGuardianOptions(['--home'])).toThrow('--home requires a directory path')
    expect(() => parseDevGuardianOptions(['--home='])).toThrow('--home requires a directory path')
  })
})

describe('devGuardianOwnerMode', () => {
  it('only advertises a controllable detached owner for the explicit launcher environment', () => {
    expect(devGuardianOwnerMode({})).toBe('foreground')
    expect(devGuardianOwnerMode({ OPENALICE_DEV_DETACHED: '0' })).toBe('foreground')
    expect(devGuardianOwnerMode({ OPENALICE_DEV_DETACHED: '1' })).toBe('detached')
  })
})
