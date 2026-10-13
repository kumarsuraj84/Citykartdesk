// Shared helpers for remediation tests. They talk to the disposable audit stack's HTTP API exactly like the app does (PostgREST + Auth),
// as real logged-in synthetic users, so row-level security and column privileges behave as for real users.
// (The audit-only guard in tests/setup/audit-only.ts has already refused to run anywhere else.)

export const API = process.env.SUPABASE_URL!
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!
export const ORG_A = '00000000-0000-0000-0000-000000000001'
export const PASSWORD = 'Audit-Pw-1!'

export type Session = { token: string; id: string; email: string }
export type Res<T = unknown> = { status: number; json: T; text: string }

export async function http<T = unknown>(method: string, path: string, opts: { token?: string; key?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Res<T>> {
  const key = opts.key ?? ANON
  const r = await fetch(API + path, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${opts.token ?? key}`, 'Content-Type': 'application/json', ...opts.headers },
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  })
  const text = await r.text()
  let json: unknown = text
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: r.status, json: json as T, text }
}

/** Service-role call (what the app's server code uses). */
export const svc = <T = unknown>(method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
  http<T>(method, '/rest/v1' + path, { key: SERVICE, token: SERVICE, body, headers })
/** Call as a logged-in user (row-level security and column privileges apply). */
export const asUser = <T = unknown>(s: Session, method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
  http<T>(method, '/rest/v1' + path, { token: s.token, body, headers })
/** Call with only the public key (no login). */
export const anon = <T = unknown>(method: string, path: string, body?: unknown) => http<T>(method, '/rest/v1' + path, { body })

export async function login(email: string): Promise<Session> {
  const r = await http<{ access_token?: string; user?: { id: string } }>('POST', '/auth/v1/token?grant_type=password', { body: { email, password: PASSWORD } })
  if (!r.json.access_token) throw new Error(`login failed for ${email}: ${r.text.slice(0, 120)}`)
  return { token: r.json.access_token, id: r.json.user!.id, email }
}

export async function createUser(email: string, fullName: string): Promise<Session> {
  const r = await http<{ id?: string }>('POST', '/auth/v1/admin/users', { key: SERVICE, token: SERVICE, body: { email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } } })
  if (!r.json.id) throw new Error(`createUser failed: ${r.text.slice(0, 200)}`)
  return login(email)
}
export const deleteUser = (id: string) => http('DELETE', `/auth/v1/admin/users/${id}`, { key: SERVICE, token: SERVICE })

export const expectDenied = (r: Res) => r.status >= 400
export async function profileRow(id: string) {
  const r = await svc<Record<string, unknown>[]>('GET', `/profiles?id=eq.${id}&select=*`)
  return r.json[0]
}
