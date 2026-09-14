import { logger } from './logger'

/**
 * DESK-OBS-003 — error-sanitization boundary.
 *
 * ~150 server-action call sites across lib/actions/**\/*.ts previously
 * returned a raw Supabase/Postgres/Auth error straight to the client, e.g.
 * `return { error: insertError.message }` — which can surface table/column
 * names, constraint internals ("duplicate key value violates unique
 * constraint \"stores_code_key\""), RLS policy text, or (for thrown
 * exceptions) a stack trace fragment.
 *
 * `sanitizeError()` is the one place that translates a raw error into a
 * stable, safe, actionable client message — logging the real error
 * server-side first (with route/context) so nothing is lost for debugging.
 * It intentionally does NOT touch the many places the app already returns
 * its own hardcoded, already-safe business messages (e.g. "The reopen
 * window for this request has expired.", "You are not assigned to this
 * request.") — those are untouched by design; this only replaces the raw
 * driver-error expression at each call site.
 */

export interface PgErrorLike {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

// Postgres SQLSTATE codes worth a specific, still-generic-enough-to-be-safe
// message — covers the brief's required categories (duplicate, invalid
// input, missing required field, unauthorized) without ever echoing the
// driver's own constraint/column/table names back to the client.
const PG_CODE_MESSAGES: Record<string, string> = {
  '23505': 'That already exists. Please check for a duplicate and try again.',
  '23503': 'This action refers to something that no longer exists — please refresh and try again.',
  '23502': 'A required field is missing. Please fill in all required fields and try again.',
  '23514': 'One of the values provided is not valid for this field.',
  '22P02': 'One of the values provided is not in the expected format.',
  '42501': 'You do not have permission to perform this action.',
  '40001': 'This record was changed by someone else at the same time. Please refresh and try again.',
  '55P03': 'This record is currently being updated elsewhere. Please try again in a moment.',
}

// Supabase Auth's own error `status`/`message` shapes are not Postgres
// SQLSTATE-coded, but a handful of messages are already safe/expected to
// show verbatim (they're written for end users by the Auth product itself)
// — everything else auth-related falls back to the generic message rather
// than risk leaking an internal Auth/GoTrue detail.
const SAFE_AUTH_MESSAGES = new Set([
  'Invalid login credentials',
  'Email not confirmed',
  'User already registered',
  'New password should be different from the old password.',
])

const DEFAULT_MESSAGE = 'Something went wrong. Please try again, and contact support if the problem persists.'

export interface SanitizeErrorOptions {
  /** Used when the error doesn't match a known, safe-to-surface case. */
  fallback?: string
  /** Server action / route name, for the server-side log line. */
  route?: string
  /** Non-sensitive structured context for the server-side log line. */
  context?: Record<string, unknown>
}

function isPgErrorLike(err: unknown): err is PgErrorLike {
  return typeof err === 'object' && err !== null && ('code' in err || 'message' in err)
}

/** Sanitizes a raw Supabase/Postgres/Auth error (or any caught exception)
 *  into a stable, client-safe message. Always logs the real error
 *  server-side first via the structured logger, with full context — nothing
 *  is lost, it's just no longer sent to the browser. */
export function sanitizeError(err: unknown, opts: SanitizeErrorOptions = {}): string {
  logger.error({
    event: 'error_sanitized',
    message: 'Raw error intercepted at the client boundary and replaced with a safe message',
    route: opts.route,
    context: opts.context,
    error: err,
  })

  if (isPgErrorLike(err)) {
    if (err.code && PG_CODE_MESSAGES[err.code]) return PG_CODE_MESSAGES[err.code]
    if (err.message && SAFE_AUTH_MESSAGES.has(err.message)) return err.message
  }

  return opts.fallback ?? DEFAULT_MESSAGE
}
