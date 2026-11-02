import 'server-only'
import type { NextRequest } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { recordAudit } from '@/lib/syslog/audit'
import { assistantAccess } from './access'
import { checkUpstream, type UpstreamTarget } from './path'
import { computeRoles } from './roles'
import { bridgeHeaders } from './sign'

// The only way a browser reaches CKOneAI. The CK Desk server checks who the person is, decides their roles, SIGNS the call itself and sends it from
// 10.0.1.98; the browser never holds a secret and never talks to CKOneAI directly.
//   - nothing the browser sent can speak for the person: every x-ckdesk-* header, Authorization and Cookie are dropped (the CK Desk session cookie never leaves this server);
//   - the request body is read ONCE as raw bytes, and those same bytes are signed and sent (no JSON re-encoding);
//   - the path and query are built once, checked (lib/ckoneai/path.ts), signed and sent as that one string;
//   - the answer streams back chunk by chunk (no compression asked for, never cached), so a long answer is not held up.

const MAX_BODY = 256 * 1024
const LIMITS = { post: 20, other: 240 }                  // per person per minute
const TIMEOUT = {
  api: { headers: 60_000, total: 10 * 60_000 },
  ui: { headers: 15_000, total: 60_000 },
}
/** Request headers that are passed on (everything else, in particular any credential, is dropped). */
const PASS_REQUEST = ['content-type', 'accept', 'if-none-match', 'if-modified-since', 'x-request-id']
/** Response headers that are passed back (set-cookie and friends never are). */
const PASS_RESPONSE = ['content-type', 'etag', 'last-modified', 'content-language', 'content-disposition']

const json = (status: number, error: string, extra?: Record<string, string>) =>
  new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } })

/** The chat page is shown in a frame: a failure there reads as a plain sentence, not as JSON. */
const friendly = (status: number, error: string) =>
  new Response('<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;margin:24px;color:#334"><p>' + error.replace(/[<>&]/g, '') + '</p><p style="color:#789">The rest of CK Desk is not affected.</p>', { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })

/** Reads the request body once, refusing more than `max` bytes without keeping the rest. */
export async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > max) return null
  if (!req.body) return new Uint8Array(0)
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { void reader.cancel().catch(() => undefined); return null }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return out
}

/** The body pass-through: ends the timers when the stream ends, fails or the browser goes away. */
function guarded(body: ReadableStream<Uint8Array>, done: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: end, value } = await reader.read()
        if (end) { done(); controller.close() } else controller.enqueue(value)
      } catch (e) { done(); controller.error(e) }
    },
    cancel(reason) { done(); return reader.cancel(reason) },
  })
}

export async function forwardToCkoneai(req: NextRequest): Promise<Response> {
  const method = req.method.toUpperCase()
  const url = req.nextUrl
  const checked = checkUpstream(url.pathname, url.search, method)
  if (!checked.ok) return json(checked.status, checked.error)
  const up: UpstreamTarget = checked.value
  const refuse = (status: number, error: string, extra?: Record<string, string>) => (up.kind === 'ui' ? friendly(status, error) : json(status, error, extra))

  const access = await assistantAccess()
  if (!access.ok) {
    if (access.reason) console.warn(`[ckoneai] refused: ${access.reason}`)
    return refuse(access.status, access.error)
  }
  const { cfg, profile } = access

  if (up.kind === 'api') {
    const isChat = method === 'POST' && up.path === '/api/ckoneai/chat'   // only a question counts against the strict limit; page loads, history and telemetry have a generous one
    const limited = await rateLimit(`ckoneai|${isChat ? 'chat' : 'other'}|${profile.id}`, isChat ? LIMITS.post : LIMITS.other)
    if (limited.limited) return refuse(429, 'Too many questions in a minute. Please wait a little.', { 'retry-after': '30' })
  }

  const hasBody = method === 'POST' || method === 'DELETE' || method === 'PATCH'
  const body = hasBody ? await readCapped(req, MAX_BODY) : new Uint8Array(0)
  if (body === null) return refuse(413, 'That message is too large.')

  let roles
  try { roles = await computeRoles(profile) } catch { return refuse(503, 'The assistant is not available right now.') }

  const headers = new Headers()
  for (const name of PASS_REQUEST) { const v = req.headers.get(name); if (v) headers.set(name, v) }
  headers.set('accept-encoding', 'identity')
  for (const [k, v] of Object.entries(bridgeHeaders({ secret: cfg.secret, method, target: up.upstream, userId: profile.id, roles, body }))) headers.set(k, v)

  const t = up.kind === 'api' ? TIMEOUT.api : TIMEOUT.ui
  const ctl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => ctl.abort(), t.headers)
  const stop = () => { if (timer) clearTimeout(timer); timer = undefined }
  req.signal.addEventListener('abort', () => { stop(); ctl.abort() }, { once: true })

  // who asked and when, never what (the question text is not kept anywhere in CK Desk)
  if (up.kind === 'api' && method === 'POST' && up.path === '/api/ckoneai/chat') {
    void recordAudit({ action: 'ckoneai.ask', entityType: 'assistant', actorId: profile.id, orgId: profile.org_id, detail: { roles, bytes: body.byteLength }, source: 'api_route' })
  }

  let res: Response
  try {
    res = await fetch(cfg.baseUrl + up.upstream, { method, headers, body: hasBody ? (body as unknown as BodyInit) : undefined, signal: ctl.signal, redirect: 'manual', cache: 'no-store' })
  } catch {
    stop()
    void recordAudit({ action: 'ckoneai.unreachable', entityType: 'assistant', actorId: profile.id, orgId: profile.org_id, outcome: 'failure', severity: 'warning', source: 'api_route' })
    return refuse(502, 'The assistant did not answer. Please try again in a moment.')
  }
  stop()
  if (res.status >= 300 && res.status < 400 && res.status !== 304) { void res.body?.cancel().catch(() => undefined); return refuse(502, 'The assistant sent an unexpected answer.') }

  const out = new Headers()
  for (const name of PASS_RESPONSE) { const v = res.headers.get(name); if (v) out.set(name, v) }
  out.set('x-content-type-options', 'nosniff')
  if (up.kind === 'api') out.set('cache-control', 'no-store, no-transform')
  else out.set('cache-control', res.headers.get('cache-control') ?? 'private, no-cache')
  out.set('x-accel-buffering', 'no')

  if (!res.body || method === 'HEAD' || res.status === 204 || res.status === 304) return new Response(null, { status: res.status, headers: out })
  timer = setTimeout(() => ctl.abort(), t.total)
  return new Response(guarded(res.body, stop), { status: res.status, headers: out })
}
