// Who a technician may copy on a ticket comment: only addresses that belong to CK Desk - an active user of the organisation
// (technician, manager, admin, requester ...) or an OEM contact listed under Master Data. No outsider address is ever accepted.

import { createAdminClient } from '@/lib/supabase/admin'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { listUsers: (opts: { page: number; perPage: number }) => any } } }

export const MAX_CC = 5

export interface CcContact {
  email: string
  name: string
  kind: 'user' | 'oem'
  /** a short hint for the picker: the person's role, or "OEM contact" */
  detail: string
  /** set for users, so the requester and the sender can be left out */
  profileId?: string
}

export type CcBook = Map<string, CcContact>

const ROLE_LABEL: Record<string, string> = { platform_owner: 'Platform owner', admin: 'Admin', manager: 'Manager', agent: 'Technician', user: 'User' }
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/

export const isEmailShape = (s: string) => EMAIL_RE.test(s.trim())

const cache = new Map<string, { at: number; book: CcBook }>()
const TTL_MS = 60_000

/** Every CK Desk address of the organisation, by lower-case e-mail. Cached for a minute. */
export async function loadCcBook(orgId: string, admin: AnyClient = createAdminClient() as unknown as AnyClient): Promise<CcBook> {
  const hit = cache.get(orgId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.book

  // The database returns at most 1000 rows per request, so the people are read in pages: a bigger organisation must not lose addresses.
  const byId = new Map<string, { name: string; role: string }>()
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('profiles').select('id, full_name, role').eq('org_id', orgId).eq('is_active', true).order('id').range(from, from + 999)
    const rows = (data ?? []) as { id: string; full_name: string; role: string }[]
    for (const p of rows) byId.set(p.id, { name: p.full_name, role: p.role })
    if (rows.length < 1000) break
  }
  const { data: oems } = await admin.from('oems').select('name, emails').eq('org_id', orgId)

  const book: CcBook = new Map()
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    const users = (data?.users ?? []) as { id: string; email?: string }[]
    if (users.length === 0) break
    for (const u of users) {
      const p = u.email ? byId.get(u.id) : undefined
      if (u.email && p) book.set(u.email.toLowerCase(), { email: u.email.toLowerCase(), name: p.name, kind: 'user', detail: ROLE_LABEL[p.role] ?? p.role, profileId: u.id })
    }
    if (users.length < 1000) break
  }
  for (const oem of (oems ?? []) as { name: string; emails: string[] | null }[]) {
    for (const email of oem.emails ?? []) {
      const key = email.trim().toLowerCase()
      if (key && !book.has(key)) book.set(key, { email: key, name: oem.name, kind: 'oem', detail: 'OEM contact' })
    }
  }
  cache.set(orgId, { at: Date.now(), book })
  return book
}

/** For tests and right after master data changes. */
export function resetCcBookCache(): void { cache.clear() }

export interface CcRejection { email: string; reason: string }

/** Keeps only the addresses that may be copied, and says why each of the others was refused. */
export function validateCc(
  emails: string[],
  book: CcBook,
  who: { requesterId: string; actorId: string },
): { accepted: CcContact[]; rejected: CcRejection[] } {
  const accepted: CcContact[] = []
  const rejected: CcRejection[] = []
  const seen = new Set<string>()
  for (const raw of emails) {
    const email = (raw ?? '').trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    if (!isEmailShape(email)) { rejected.push({ email, reason: 'Not a valid e-mail address.' }); continue }
    const c = book.get(email)
    if (!c) { rejected.push({ email, reason: 'Not a CK Desk address. Only CK Desk users and OEM contacts can be copied.' }); continue }
    if (c.profileId === who.actorId) { rejected.push({ email, reason: 'That is you.' }); continue }
    if (c.profileId === who.requesterId) { rejected.push({ email, reason: 'The requester already receives this comment.' }); continue }
    if (accepted.length >= MAX_CC) { rejected.push({ email, reason: `At most ${MAX_CC} addresses can be copied on one comment.` }); continue }
    accepted.push(c)
  }
  return { accepted, rejected }
}

/** Suggestions for the CC box: people and OEM contacts whose name, e-mail or OEM name contains the text. */
export function searchCcBook(book: CcBook, q: string, limit = 8): CcContact[] {
  const t = q.trim().toLowerCase()
  if (t.length < 2) return []
  const out: CcContact[] = []
  for (const c of book.values()) {
    if (c.email.includes(t) || c.name.toLowerCase().includes(t)) out.push(c)
  }
  // exact e-mail first, then names that start with the text, then the rest
  const rank = (c: CcContact) => (c.email === t ? 0 : c.name.toLowerCase().startsWith(t) || c.email.startsWith(t) ? 1 : 2)
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, limit)
}
