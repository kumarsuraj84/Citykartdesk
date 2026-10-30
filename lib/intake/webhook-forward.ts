// Shared parts of the public mail-notification endpoints (Gmail push, Outlook change notifications): reading a request body with a hard size limit, handing a
// notification to the intake worker and waiting for the answer, and taking back a "seen" mark when that hand-over failed.

import { createAdminClient } from '@/lib/supabase/admin'
import { fetchWithTimeout } from '@/lib/http/fetch-timeout'
import { getSecret } from '@/lib/secrets'
import { logger } from '@/lib/observability/logger'

/**
 * Reads the request body but stops (and refuses) as soon as more than `maxBytes` have arrived. Content-Length cannot be trusted for this: it is missing on a
 * chunked request, and `req.text()` / `req.json()` read the whole body into memory before any size can be checked.
 */
export async function readCappedBody(req: Request, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false }
  if (!req.body) return { ok: true, text: '' }
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return { ok: false }
    }
    chunks.push(value)
  }
  const all = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { all.set(c, at); at += c.byteLength }
  return { ok: true, text: new TextDecoder().decode(all) }
}

/** The worker's base address and secret, or null when either is missing. */
export function intakeWorkerTarget(): { baseUrl: string; secret: string } | null {
  const raw = process.env.INTAKE_WORKER_URL
  const secret = getSecret('intake_worker')
  if (!raw || !secret) return null
  return { baseUrl: (/^https?:\/\//.test(raw) ? raw : `https://${raw}`).replace(/\/$/, ''), secret }
}

/**
 * Hands one notification to the worker and waits for its answer. `ok` only when the worker answered 2xx. A time-out counts as a failure although the worker
 * may still finish the job: the notification is then delivered again, which is safe because the worker stores each mail once (it dedups by message id).
 */
export async function forwardToWorker(path: string, body: Record<string, unknown>, timeoutMs = 8000): Promise<{ ok: true } | { ok: false; reason: string }> {
  const target = intakeWorkerTarget()
  if (!target) return { ok: false, reason: 'worker_not_configured' }
  try {
    const res = await fetchWithTimeout(`${target.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-intake-worker-secret': target.secret },
      body: JSON.stringify(body),
    }, timeoutMs)
    if (!res.ok) return { ok: false, reason: `worker_status_${res.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.name : 'worker_unreachable' }
  }
}

/**
 * Takes back the "this notification was seen" mark made by firstDelivery(), because the hand-over to the worker failed. Without it the sender's retry would be
 * dropped as a repeat and the mail would never be picked up. Never throws: if the mark cannot be removed the retry is dropped, which is logged.
 */
export async function forgetDelivery(key: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (createAdminClient() as any).rpc('webhook_seen_forget', { p_key: key })
    if (error) throw new Error(error.message ?? error.code ?? 'webhook_seen_forget failed')
  } catch (e) {
    logger.error({ event: 'intake.webhook_forget_failed', message: 'A failed hand-over could not be taken back; the sender\'s retry may be dropped as a repeat.', context: { key }, error: e })
  }
}
