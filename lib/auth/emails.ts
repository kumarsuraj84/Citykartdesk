// ONE place that turns "e-mail address <-> sign-in account" into answers (audit A-24 / H-07). The sign-in service has no "find by e-mail" call, so every
// lookup has to read the account list page by page. That scan was written about nine times, most of them reading ONE page of 1000 (so the 1001st account
// was invisible: a duplicate was not found, a name stayed blank) and one of them giving up silently after 50 pages and answering "not in use".
// Here the scan reads every page, and when it cannot finish (the sign-in service errors, or there are implausibly many pages) it SAYS SO:
// the caller decides what that means (an "is this address taken?" check must treat it as "do not proceed", never as "free").

const PER_PAGE = 1000
const MAX_PAGES = 200            // 200,000 accounts: far beyond this system; a guard against a service that never ends a list

type AuthAdminLike = {
  auth: { admin: { listUsers: (opts: { page: number; perPage: number }) => Promise<{ data?: { users?: { id: string; email?: string | null }[] } | null; error?: { message?: string } | null }> } }
}

export type AuthScan<T> = { ok: true; value: T } | { ok: false; error: string }

/** Calls `visit` for every sign-in account until it returns true (found) or the list ends. */
async function scan(admin: AuthAdminLike, visit: (u: { id: string; email: string }) => boolean): Promise<AuthScan<{ found: boolean }>> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    let res
    try { res = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE }) } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'the sign-in service did not answer' } }
    if (res.error) return { ok: false, error: res.error.message ?? 'the sign-in service refused the list' }
    const users = res.data?.users ?? []
    for (const u of users) if (u.email && visit({ id: u.id, email: u.email })) return { ok: true, value: { found: true } }
    if (users.length < PER_PAGE) return { ok: true, value: { found: false } }
  }
  return { ok: false, error: `more than ${MAX_PAGES * PER_PAGE} accounts: the list was not read to the end` }
}

/** The account with this e-mail address (any organisation: sign-in addresses are shared by the whole system), or null when there is none. */
export async function findAuthUserByEmail(admin: AuthAdminLike, email: string): Promise<AuthScan<{ id: string; email: string } | null>> {
  const wanted = email.trim().toLowerCase()
  let hit: { id: string; email: string } | null = null
  const r = await scan(admin, (u) => { if (u.email.trim().toLowerCase() === wanted) { hit = u; return true } return false })
  return r.ok ? { ok: true, value: hit } : r
}

/** id -> lower-cased e-mail for every account (or only the ids given). */
export async function listAuthEmails(admin: AuthAdminLike, ids?: Iterable<string>): Promise<AuthScan<Map<string, string>>> {
  const only = ids ? new Set(ids) : null
  const byId = new Map<string, string>()
  const r = await scan(admin, (u) => { if (!only || only.has(u.id)) byId.set(u.id, u.email.trim().toLowerCase()); return false })
  return r.ok ? { ok: true, value: byId } : r
}

/** e-mail -> id for the accounts among `ids` (an organisation's members); same complete scan. */
export async function listAuthIdsByEmail(admin: AuthAdminLike, ids: Iterable<string>): Promise<AuthScan<Map<string, string>>> {
  const r = await listAuthEmails(admin, ids)
  if (!r.ok) return r
  return { ok: true, value: new Map([...r.value].map(([id, email]) => [email, id])) }
}
