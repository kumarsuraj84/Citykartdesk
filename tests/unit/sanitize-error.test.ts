/**
 * DESK-OBS-003 — error-sanitization boundary.
 *
 * Requirements from the remediation brief: the client gets a safe,
 * actionable message; the raw error is still logged server-side with
 * context; known categories (unauthorized, duplicate, invalid input,
 * stale/concurrent change, missing required field) map to stable friendly
 * messages; and unexpected DB internals (table/column names, constraint
 * text, stack traces, tokens, hostnames) must never reach the client.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { sanitizeError } from '@/lib/observability/sanitize-error'

describe('sanitizeError()', () => {
  afterEach(() => vi.restoreAllMocks())

  it('a Postgres unique-violation (23505) maps to a stable duplicate message, never the raw constraint text', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = { code: '23505', message: 'duplicate key value violates unique constraint "stores_code_key"' }
    const msg = sanitizeError(raw)
    expect(msg).toBe('That already exists. Please check for a duplicate and try again.')
    expect(msg).not.toContain('stores_code_key')
    expect(msg).not.toContain('constraint')
    errorSpy.mockRestore()
  })

  it('a foreign-key violation (23503) maps to a stable "no longer exists" message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = { code: '23503', message: 'insert or update on table "tasks" violates foreign key constraint "tasks_project_id_fkey"' }
    const msg = sanitizeError(raw)
    expect(msg).toBe('This action refers to something that no longer exists — please refresh and try again.')
    expect(msg).not.toContain('tasks_project_id_fkey')
    expect(msg).not.toContain('"tasks"')
  })

  it('a not-null violation (23502) maps to a "missing required field" message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = { code: '23502', message: 'null value in column "team_id" of relation "requests" violates not-null constraint' }
    const msg = sanitizeError(raw)
    expect(msg).toBe('A required field is missing. Please fill in all required fields and try again.')
    expect(msg).not.toContain('team_id')
    expect(msg).not.toContain('relation "requests"')
  })

  it('an RLS/insufficient-privilege error (42501) maps to an "unauthorized" message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = { code: '42501', message: 'new row violates row-level security policy for table "approvals"' }
    const msg = sanitizeError(raw)
    expect(msg).toBe('You do not have permission to perform this action.')
    expect(msg).not.toContain('row-level security')
    expect(msg).not.toContain('"approvals"')
  })

  it('a serialization/concurrent-update conflict (40001) maps to a "changed by someone else" message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = { code: '40001', message: 'could not serialize access due to concurrent update' }
    const msg = sanitizeError(raw)
    expect(msg).toBe('This record was changed by someone else at the same time. Please refresh and try again.')
  })

  it('an unrecognized Postgres code falls back to the caller-supplied fallback, not the raw message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = { code: '55006', message: 'object not in prerequisite state: internal detail xyz' }
    const msg = sanitizeError(raw, { fallback: 'Failed to create request.' })
    expect(msg).toBe('Failed to create request.')
    expect(msg).not.toContain('prerequisite state')
  })

  it('an unrecognized error with no fallback supplied uses the generic default message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const msg = sanitizeError({ message: 'connection to 10.0.4.2:5432 refused' })
    expect(msg).toBe('Something went wrong. Please try again, and contact support if the problem persists.')
    expect(msg).not.toContain('10.0.4.2')
  })

  it('a known, product-safe Supabase Auth message ("Invalid login credentials") passes through unchanged', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const msg = sanitizeError({ message: 'Invalid login credentials' })
    expect(msg).toBe('Invalid login credentials')
  })

  it('an unrecognized Auth-shaped message is NOT passed through — falls back to the generic message instead', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // e.g. an internal GoTrue/JWT/hostname detail that happens to arrive
    // with no `code`, only a `message` — must not leak verbatim.
    const msg = sanitizeError({ message: 'jwt signature verification failed: secret rotated at auth.internal.example' })
    expect(msg).toBe('Something went wrong. Please try again, and contact support if the problem persists.')
    expect(msg).not.toContain('auth.internal.example')
  })

  it('a plain thrown Error (not a Postgres/Auth error at all) never leaks its message to the client', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const msg = sanitizeError(new Error('ENOENT: no such file /var/app/secrets/service-role.key'))
    expect(msg).toBe('Something went wrong. Please try again, and contact support if the problem persists.')
    expect(msg).not.toContain('service-role.key')
  })

  it('a bare string exception never leaks verbatim', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const msg = sanitizeError('Internal: table request_activity has no column org_id')
    expect(msg).toBe('Something went wrong. Please try again, and contact support if the problem persists.')
    expect(msg).not.toContain('request_activity')
  })

  it('always logs the real error server-side (via the structured logger) with route/context, even though the client never sees it', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sanitizeError({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }, {
      route: 'lib/actions/admin/org.ts#createStore',
      context: { orgId: 'org-1' },
    })
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string)
    expect(logged.event).toBe('error_sanitized')
    expect(logged.route).toBe('lib/actions/admin/org.ts#createStore')
    expect(logged.context).toEqual({ orgId: 'org-1' })
    // The raw error text IS present in the server-side log (nothing is lost
    // for debugging) — it's only withheld from the sanitized return value.
    expect(JSON.stringify(logged)).toContain('duplicate key value')
  })
})
