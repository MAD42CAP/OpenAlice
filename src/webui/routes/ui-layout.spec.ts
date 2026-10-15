import { describe, expect, it, vi } from 'vitest'

import { defaultUiLayout, parseUiLayoutWrite, UiLayoutError } from '../../core/ui-layout.js'
import { createUiLayoutRoutes } from './ui-layout.js'

describe('ui-layout routes', () => {
  it('accepts and returns a customized Research entry through the layout contract', async () => {
    const layout = defaultUiLayout()
    layout.groups[0].items = layout.groups[0].items.filter((page) => page !== 'research')
    layout.groups.push({ id: 'custom:desk', label: 'Desk', items: ['research'] })
    layout.hidden.push('research')
    const app = createUiLayoutRoutes({
      readUiLayout: vi.fn(),
      writeUiLayout: async (input) => parseUiLayoutWrite(input),
    })

    const response = await app.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(layout),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(layout)
  })

  it('reads the current Activity Bar layout', async () => {
    const layout = defaultUiLayout()
    const read = vi.fn(async () => layout)
    const app = createUiLayoutRoutes({
      readUiLayout: read,
      writeUiLayout: vi.fn(),
    })

    const response = await app.request('/')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(layout)
    expect(read).toHaveBeenCalledOnce()
  })

  it('writes a valid layout and rejects an invalid one', async () => {
    const layout = defaultUiLayout()
    const write = vi.fn(async () => layout)
    const app = createUiLayoutRoutes({
      readUiLayout: vi.fn(),
      writeUiLayout: write,
    })

    const ok = await app.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(layout),
    })
    expect(ok.status).toBe(200)
    expect(write).toHaveBeenCalledWith(layout)

    const failing = createUiLayoutRoutes({
      readUiLayout: vi.fn(),
      writeUiLayout: vi.fn(async () => {
        throw new UiLayoutError('Settings cannot be hidden from the Activity Bar')
      }),
    })
    const bad = await failing.request('/', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...layout, hidden: ['settings'] }),
    })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({
      error: 'invalid_ui_layout',
      message: 'Settings cannot be hidden from the Activity Bar',
    })
  })
})
