// A store's CVM is an existing CKDesk user (staff: technician, manager, admin or owner). The Store Master sheet names the CVM by e-mail or by full name; this
// turns that text into a user id, refusing a name that fits two people so a store is never given the wrong CVM. Pure, so every rule is easy to test.

export const CVM_ROLES = ['agent', 'manager', 'admin', 'platform_owner'] as const

export type CvmCandidates = {
  /** lower-case full name -> ids of the active staff members with that name */
  byName: Map<string, string[]>
  /** lower-case e-mail -> id of that active staff member */
  byEmail: Map<string, string>
}

export function buildCvmCandidates(
  staff: { id: string; full_name: string }[],
  emailsById: Map<string, string>,
): CvmCandidates {
  const byName = new Map<string, string[]>()
  const byEmail = new Map<string, string>()
  for (const s of staff) {
    const key = s.full_name.trim().toLowerCase()
    if (key) byName.set(key, [...(byName.get(key) ?? []), s.id])
    const email = emailsById.get(s.id)?.trim().toLowerCase()
    if (email) byEmail.set(email, s.id)
  }
  return { byName, byEmail }
}

export type CvmResolution = { id: string } | { error: string }

export function resolveCvm(value: string, c: CvmCandidates): CvmResolution {
  const v = value.trim().toLowerCase()
  if (!v) return { error: 'empty' }
  const byMail = c.byEmail.get(v)
  if (byMail) return { id: byMail }
  const named = c.byName.get(v)
  if (named?.length === 1) return { id: named[0] }
  if (named && named.length > 1) return { error: `more than one active staff member is called "${value}" - use the e-mail address` }
  return { error: `"${value}" is not an active staff member (technician, manager or admin) of this organisation` }
}
