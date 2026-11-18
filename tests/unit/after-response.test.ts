// afterResponse(): work the person need not wait for. Outside a web request (scheduled jobs, tests) it must behave as before: do the work right away, wait for it, and log a failure.
import { describe, it, expect, vi } from 'vitest'

const { loggerErrorMock } = vi.hoisted(() => ({ loggerErrorMock: vi.fn() }))
vi.mock('@/lib/observability/logger', () => ({ logger: { error: loggerErrorMock, warn: vi.fn(), info: vi.fn() } }))

import { afterResponse } from '@/lib/requests/after-response'

describe('afterResponse outside a web request', () => {
  it('runs the work now and the caller waits for it', async () => {
    let done = false
    await afterResponse('survey', async () => { await new Promise((r) => setTimeout(r, 10)); done = true })
    expect(done).toBe(true)
  })
  it('a failing step is logged with its name and the request, and never thrown to the caller', async () => {
    loggerErrorMock.mockClear()
    await expect(afterResponse('survey', async () => { throw new Error('mail server down') }, { requestId: 'r1' })).resolves.toBeUndefined()
    expect(loggerErrorMock).toHaveBeenCalledWith(expect.objectContaining({ event: 'after_response.failed', requestId: 'r1', context: { step: 'survey' } }))
  })
})
