import { readVerifiedUserId } from '@/lib/auth/verified-user'
import { recordSystemLog, flushSystemLog } from './record'
import { toRow } from './row'
import { fileSpool } from './spool'
import { type FailureReport, setFailureReporter } from './failure-reporter'
import { type Source, errorCodeOfBody, judgeResponse, sourceOfUrl } from './shape'

// Errors the application never saw itself: unhandled exceptions in pages, route handlers, server actions and the proxy (Next's request-error
// hook), and crashes of the Node process. Used by instrumentation.ts.

const first = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

export interface NextRequestInfo { path: string; method: string; headers: Record<string, string | string[] | undefined> }
export interface NextErrorContext { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string; revalidateReason?: string; renderType?: string }

const SOURCE_OF_ROUTE_TYPE: Record<string, Source> = { route: 'api_route', action: 'server_action', render: 'app_server', proxy: 'app_server' }

// A redirect or a "not found" is how Next steers the user, not a failure.
const CONTROL_FLOW = /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|NEXT_PRERENDER)/

export async function recordRequestError(err: unknown, request: NextRequestInfo, context: NextErrorContext): Promise<void> {
  const e = err as { message?: string; stack?: string; digest?: string; name?: string }
  if (e?.digest && CONTROL_FLOW.test(e.digest)) return
  if (e?.message && CONTROL_FLOW.test(e.message)) return
  const get = (n: string) => first(request.headers?.[n.toLowerCase()])
  const verified = readVerifiedUserId({ get })
  const hops = Number(process.env.TRUSTED_PROXY_HOPS ?? 0)
  const parts = (get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  await recordSystemLog({
    category: 'error',
    source: SOURCE_OF_ROUTE_TYPE[context.routeType ?? ''] ?? 'app_server',
    severity: 'error',
    action: `request.${context.routeType ?? 'unknown'}_error`,
    message: e?.message ?? String(err),
    errorCode: e?.digest ?? e?.name ?? null,
    stack: e?.stack ?? null,
    path: request.path,
    method: request.method,
    requestId: get('x-request-id'),
    userAgent: get('user-agent'),
    ip: Number.isInteger(hops) && hops >= 1 && parts.length >= hops ? parts[parts.length - hops] : null,
    actorId: typeof verified === 'string' ? verified : null,
    detail: { routePath: context.routePath, routerKind: context.routerKind, renderSource: context.renderSource, renderType: context.renderType, digest: e?.digest },
  })
}

/** The address of a called service without its query string (which can carry keys or filters). */
export function addressForLog(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname}`
  } catch {
    return url.split('?')[0].slice(0, 200)
  }
}

/** Turn a failed call to the database, auth, storage or an outside service into a System Log row (if it is worth one). */
export function reportFailedCall(r: FailureReport): void {
  const source = sourceOfUrl(r.url)
  const where = addressForLog(r.url)
  if (r.url.includes('/rest/v1/system_log')) return                      // never report the log's own failures through itself
  const method = (r.method || 'GET').toUpperCase()
  if (r.error !== undefined) {
    const e = r.error as { message?: string; name?: string; cause?: { code?: string } }
    const code = e?.cause?.code ?? e?.name ?? 'network_error'
    void recordSystemLog({
      category: 'error', source, severity: 'error', outcome: 'failure', action: `${source}.call_failed`,
      message: `${method} ${where}: ${e?.message ?? 'the call failed'}`, errorCode: String(code), detail: { url: where, method, ms: r.ms },
    })
    return
  }
  const { code, message } = errorCodeOfBody(r.body ?? '')
  const v = judgeResponse(r.status ?? 0, source, code, method)
  if (!v.record) return
  void recordSystemLog({
    category: v.category, source, severity: v.severity, outcome: v.outcome, action: `${source}.http_${r.status}`,
    message: `${method} ${where} -> ${r.status}${message ? ': ' + message : ''}`, errorCode: code ?? String(r.status),
    detail: { url: where, method, status: r.status, ms: r.ms },
  })
}

let installed = false

/** Observe crashes of the Node process. Adds no behaviour of its own: the process still exits exactly as it would have. */
export function installProcessHandlers(): void {
  if (installed) return
  installed = true
  setFailureReporter(reportFailedCall)

  // 'uncaughtExceptionMonitor' observes without taking over (a normal 'uncaughtException' listener would stop the process from exiting).
  // The row is appended to the spool SYNCHRONOUSLY, because the process may be gone before any database write finishes; it is sent
  // to the database by the next start-up (or the next retry tick).
  process.on('uncaughtExceptionMonitor', (err, origin) => {
    try {
      const e = err as Error
      const row = toRow({ category: 'error', source: 'process', severity: 'critical', action: `process.${origin ?? 'uncaughtException'}`, message: e?.message ?? String(err), stack: e?.stack ?? null, errorCode: e?.name ?? null })
      fileSpool().append([row])
      console.error(JSON.stringify({ level: 'error', event: 'process.crash', origin, message: e?.message }))
    } catch { /* nothing more can be done */ }
  })

  process.on('unhandledRejection', (reason) => {
    const e = reason as Error
    void recordSystemLog({ category: 'error', source: 'process', severity: 'error', action: 'process.unhandledRejection', message: e?.message ?? String(reason), stack: e?.stack ?? null, errorCode: e?.name ?? null })
    // Our listener must not turn a crash into a silent continue: when nobody else handles rejections, behave as Node does by default.
    if (process.listenerCount('unhandledRejection') === 1) throw reason
  })

  process.on('beforeExit', () => { void flushSystemLog() })
}
