// @vitest-environment jsdom
/**
 * Live report (event log): "Minified React error #418" — a text mismatch while hydrating — on the
 * ticket page of a RESOLVED ticket, again and again for the same ticket. The reopen countdown
 * ("23h 59m left") was worked out from the clock while the page was drawn, so the server's text
 * and the browser's text, a moment later, could differ once a minute ticked over. This test draws
 * the page the way the server does, then hydrates it ~90 seconds later, and fails on any error.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { act } from 'react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/actions/requests', () => ({ updateRequestStatus: vi.fn() }))

import { ResolvedReopenBanner } from '@/components/requests/ResolvedReopenBanner'
import { ApprovalRejectedReopenBanner } from '@/components/requests/ApprovalRejectedReopenBanner'

const SERVER_NOW = new Date('2026-10-04T20:16:30Z').getTime()
const BROWSER_NOW = SERVER_NOW + 90_000 // the browser hydrates 90 seconds after the server drew it
const DEADLINE = '2026-10-05T17:37:08Z'

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

async function hydrateAfterServerRender(element: React.ReactElement) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(SERVER_NOW)
  const html = renderToString(element)

  vi.setSystemTime(BROWSER_NOW)
  const container = document.createElement('div')
  container.innerHTML = html
  document.body.appendChild(container)

  const errors: string[] = []
  const origError = console.error
  console.error = (...args: unknown[]) => { errors.push(String(args[0])) }
  await act(async () => {
    hydrateRoot(container, element, { onRecoverableError: (e) => errors.push(e instanceof Error ? e.message : String(e)) })
  })
  console.error = origError
  return errors
}

describe('reopen countdowns hydrate without a text mismatch', () => {
  it('resolved ticket banner', async () => {
    const errors = await hydrateAfterServerRender(
      <ResolvedReopenBanner requestId="r1" reopenDeadlineAt={DEADLINE} windowHours={72} />
    )
    expect(errors).toEqual([])
  })

  it('approval-rejected banner', async () => {
    const errors = await hydrateAfterServerRender(
      <ApprovalRejectedReopenBanner requestId="r1" reopenDeadlineAt={DEADLINE} />
    )
    expect(errors).toEqual([])
  })
})
