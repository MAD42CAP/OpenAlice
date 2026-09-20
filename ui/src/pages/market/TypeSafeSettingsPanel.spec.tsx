// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TypeSafeSettingsPanel } from './TypeSafeSettingsPanel'
import { i18n } from '../../i18n'
const mock = vi.hoisted(() => ({ hook: vi.fn(), save: vi.fn(), test: vi.fn() }))
vi.mock('../../hooks/useTypeSafe', () => ({ useTypeSafeSettings: mock.hook }))
beforeEach(async () => { await i18n.changeLanguage('en'); mock.save.mockResolvedValue(true); mock.test.mockResolvedValue(true); mock.hook.mockReturnValue({ settings: { configured: true, automatic: false, model: 'jev-1.13.0' }, error: null, busy: false, save: mock.save, test: mock.test }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('uses an empty password input, clears it after saving and only tests a saved key', async () => {
  render(<TypeSafeSettingsPanel />)
  const input = screen.getByLabelText('TypeSafe API Key') as HTMLInputElement
  expect(input.type).toBe('password'); expect(input.value).toBe('')
  fireEvent.change(input, { target: { value: 'test-only-placeholder' } })
  expect((screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  await waitFor(() => expect(input.value).toBe(''))
  expect(mock.save).toHaveBeenCalledWith({ apiKey: 'test-only-placeholder', automatic: false })
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('real Jev classification'))
})
it('displays configuration read errors and prevents accidental save over unreadable settings', () => {
  mock.hook.mockReturnValue({ ...mock.hook(), settings: null, error: 'load' })
  render(<TypeSafeSettingsPanel />)
  expect(screen.getByRole('alert').textContent).toContain('could not be loaded')
  expect((screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(true)
})
it('never describes a demo test as a real provider call', async () => {
  mock.test.mockResolvedValue('demo')
  render(<TypeSafeSettingsPanel />)
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('no real Jev call'))
})
