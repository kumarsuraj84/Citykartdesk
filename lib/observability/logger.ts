/**
 * DESK-OBS-001 — shared structured logging abstraction.
 *
 * There is currently no APM/error tracker in this environment, and adding
 * one would need live external credentials this environment doesn't have.
 * This gives every critical flow (crons, business-rule execution, email
 * dispatch, error-boundary logging) one consistent, structured event shape
 * instead of ad hoc `console.error(string)` calls — so a real APM/log
 * pipeline can be wired in later by swapping only the `emit()` sink below,
 * with zero call-site changes.
 *
 * Deliberately applied first to critical flows (crons, business rules,
 * email, error sanitization) rather than an uncontrolled repo-wide rewrite
 * of every existing console.log/console.error call site.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogEvent {
  level: LogLevel
  /** Short, stable, machine-greppable event name — e.g. 'cron.alerts.rule_failed'. */
  event: string
  /** Human-readable summary — no secrets, no full message bodies. */
  message: string
  /** Route, server action name, or cron job name this event occurred in. */
  route?: string
  requestId?: string
  taskId?: string
  projectId?: string
  actorId?: string
  orgId?: string
  /** Correlation id for one cron run / one request lifecycle, so every
   *  event from a single execution can be grepped together. */
  correlationId?: string
  /** A stable, non-sensitive error code/category — e.g. 'email_send_failed',
   *  'sla_config_invalid' — never the raw driver error message. */
  errorCode?: string
  /** Additional structured context. Redacted before emission (see below). */
  context?: Record<string, unknown>
  /** The real Error, if any — its message/stack are only ever logged
   *  server-side (this module never runs in the browser) and are still
   *  passed through the same redaction as `context`. */
  error?: unknown
}

const SECRET_KEY_PATTERN = /pass(word)?|secret|token|api[-_]?key|authoriz(a|e)tion|bearer|cookie|credential/i
const REDACTED = '[redacted]'

/** Recursively strips values whose key looks secret-shaped. Bounded depth so
 *  a pathological/circular object can't hang the logger. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1)
  }
  return out
}

function serializeError(err: unknown): { message: string; stack?: string } | undefined {
  if (err === undefined) return undefined
  if (err instanceof Error) {
    // Stack traces are server-side only by construction: this module has no
    // client entry point, and callers must not forward `error.stack` to a
    // client-facing response (see lib/observability/sanitize-error.ts).
    return { message: err.message, stack: err.stack }
  }
  return { message: typeof err === 'string' ? err : JSON.stringify(err) }
}

/** The actual emission sink. Swap this (and only this) to wire in a real
 *  log pipeline later — every call site above stays unchanged. */
function emit(payload: Record<string, unknown>): void {
  const line = JSON.stringify(payload)
  if (payload.level === 'error') console.error(line)
  else if (payload.level === 'warn') console.warn(line)
  else console.log(line)
}

export function log(evt: LogEvent): void {
  emit({
    ts: new Date().toISOString(),
    level: evt.level,
    event: evt.event,
    message: evt.message,
    route: evt.route,
    requestId: evt.requestId,
    taskId: evt.taskId,
    projectId: evt.projectId,
    actorId: evt.actorId,
    orgId: evt.orgId,
    correlationId: evt.correlationId,
    errorCode: evt.errorCode,
    context: evt.context ? redact(evt.context) : undefined,
    error: serializeError(evt.error),
  })
}

export const logger = {
  debug: (evt: Omit<LogEvent, 'level'>) => log({ ...evt, level: 'debug' }),
  info: (evt: Omit<LogEvent, 'level'>) => log({ ...evt, level: 'info' }),
  warn: (evt: Omit<LogEvent, 'level'>) => log({ ...evt, level: 'warn' }),
  error: (evt: Omit<LogEvent, 'level'>) => log({ ...evt, level: 'error' }),
}
