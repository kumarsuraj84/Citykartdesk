// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const fetchMock = vi.fn()

async function loadBanner(buildAtLoad: string) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_BUILD_ID', buildAtLoad) // fixed into the page's code at build time
  const { NewVersionBanner } = await import('@/components/layout/NewVersionBanner')
  return NewVersionBanner
}

function serverIsRunning(buildId: string) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ buildId }) })
}

async function tick(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('NewVersionBanner', () => {
  it('stays hidden while the server is still running the version this page was loaded with', async () => {
    const Banner = await loadBanner('20261005-1741')
    serverIsRunning('20261005-1741')
    render(<Banner />)
    await tick(5 * 60 * 1000)
    expect(fetchMock).toHaveBeenCalledWith('/api/version', { cache: 'no-store' })
    expect(screen.queryByText(/new version of Citykart Desk/)).toBeNull()
  })

  it('offers a refresh once a newer version is live', async () => {
    const Banner = await loadBanner('20261005-1741')
    serverIsRunning('20261006-0900')
    render(<Banner />)
    await tick(5 * 60 * 1000)
    expect(screen.getByText(/new version of Citykart Desk is available/)).toBeTruthy()
    expect(screen.getByText('Refresh')).toBeTruthy()
  })

  it('checks right away when the person comes back to the tab', async () => {
    const Banner = await loadBanner('v1')
    serverIsRunning('v2')
    render(<Banner />)
    expect(fetchMock).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(screen.getByText(/new version of Citykart Desk is available/)).toBeTruthy()
  })

  it('"remind me later" hides it', async () => {
    const Banner = await loadBanner('v1')
    serverIsRunning('v2')
    render(<Banner />)
    await tick(5 * 60 * 1000)
    fireEvent.click(screen.getByLabelText('Remind me later'))
    expect(screen.queryByText(/new version of Citykart Desk/)).toBeNull()
  })

  it('says nothing when the check fails (offline, or the server is restarting)', async () => {
    const Banner = await loadBanner('v1')
    fetchMock.mockRejectedValue(new Error('network'))
    render(<Banner />)
    await tick(5 * 60 * 1000)
    expect(screen.queryByText(/new version of Citykart Desk/)).toBeNull()
    fetchMock.mockResolvedValue({ ok: false })
    await tick(5 * 60 * 1000)
    expect(screen.queryByText(/new version of Citykart Desk/)).toBeNull()
  })

  it('does nothing in local development', async () => {
    const Banner = await loadBanner('dev')
    serverIsRunning('something-else')
    render(<Banner />)
    await tick(10 * 60 * 1000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/new version of Citykart Desk/)).toBeNull()
  })
})

describe('GET /api/version', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('reports the build this server is running, uncached', async () => {
    vi.resetModules()
    vi.stubEnv('NEXT_PUBLIC_BUILD_ID', '20261006-0900')
    const { GET } = await import('@/app/api/version/route')
    const res = GET()
    expect(await res.json()).toEqual({ buildId: '20261006-0900' })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
