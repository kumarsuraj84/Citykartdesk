import { after } from 'next/server'
import { logger } from '@/lib/observability/logger'

/**
 * Runs work that must happen but that the person does not need to wait for (sending a survey e-mail, for example) AFTER the answer has been sent to the browser
 * (Next's after()). A failure is logged with the label and the request, never shown to the person: by then the change they asked for has already been saved.
 *
 * Outside a web request (a scheduled job, a test) there is no "after the answer": the work then runs right away and the returned promise waits for it, so the behaviour there
 * is exactly what it was before this helper existed. Inside a request the returned promise is already done: the caller does not wait.
 */
export async function afterResponse(label: string, fn: () => Promise<void>, context: { requestId?: string } = {}): Promise<void> {
  const run = async () => {
    try {
      await fn()
    } catch (e) {
      logger.error({ event: 'after_response.failed', message: `The step "${label}" failed after the answer was sent`, route: 'lib/requests/after-response.ts', requestId: context.requestId, errorCode: 'after_response_failed', context: { step: label }, error: e })
    }
  }
  try {
    after(run)
  } catch {
    await run()   // not inside a request: do it now
  }
}
