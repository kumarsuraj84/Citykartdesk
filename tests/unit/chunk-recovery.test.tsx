// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { decideReload, isChunkLoadError, MAX_RELOADS, WINDOW_MS } from '@/lib/ui/chunk-recovery'
import { ChunkErrorRecovery } from '@/components/ChunkErrorRecovery'

// A browser that cannot load a page file reloads a LIMITED number of times and then says what to do, instead of reloading and logging for hours.
describe('deciding about a reload', () => {
  it('recognises the failures of a missing page file', () => {
    expect(isChunkLoadError('Loading chunk 123 failed.\n(error: http://x/_next/static/chunks/a.js)')).toBe(true)
    expect(isChunkLoadError('ChunkLoadError: boom')).toBe(true)
    expect(isChunkLoadError('Failed to fetch dynamically imported module: http://x/a.js')).toBe(true)
    expect(isChunkLoadError('Could not load the signed-in profile')).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })

  it(`reloads at most ${MAX_RELOADS} times in ${WINDOW_MS / 60000} minutes, then asks the person to refresh`, () => {
    let h: number[] = []
    const t0 = 1_000_000
    const first = decideReload(h, t0); h = first.history
    const second = decideReload(h, t0 + 15_000); h = second.history
    const third = decideReload(h, t0 + 30_000)
    expect([first.reload, second.reload, third.reload]).toEqual([true, true, false])
  })

  it('the allowance comes back after the window has passed', () => {
    const old = [1_000_000, 1_020_000]
    expect(decideReload(old, 1_000_000 + WINDOW_MS + 60_000).reload).toBe(true)
  })
})

describe('the window-level recovery', () => {
  const reload = vi.fn()
  const original = window.location
  beforeEach(() => {
    reload.mockClear(); window.sessionStorage.clear()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } })
  })
  afterEach(() => { cleanup(); Object.defineProperty(window, 'location', { configurable: true, value: original }) })

  const fail = () => act(() => { window.dispatchEvent(new ErrorEvent('error', { message: 'Loading chunk 99 failed. (error: http://x/_next/static/chunks/a.js)' })) })

  it('reloads twice, then shows the notice with the Ctrl+F5 advice and stops reloading', () => {
    render(<ChunkErrorRecovery />)
    expect(screen.queryByRole('alert')).toBeNull()
    fail(); fail()
    expect(reload).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    fail(); fail(); fail()
    expect(reload).toHaveBeenCalledTimes(2)                                 // no further reload, however often it fails
    expect(screen.getByRole('alert').textContent).toContain('Ctrl + F5')
  })

  it('an unrelated error does nothing', () => {
    render(<ChunkErrorRecovery />)
    act(() => { window.dispatchEvent(new ErrorEvent('error', { message: 'Something else broke' })) })
    expect(reload).not.toHaveBeenCalled()
  })
})
