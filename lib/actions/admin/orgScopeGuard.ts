// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

/**
 * Verifies every referenced id actually belongs to the caller's own org
 * before an admin-client write persists it onto a profile or record. Every
 * one of these tables has an org_id column (departments, locations,
 * cost_centers, job_functions, designations, stores, profiles).
 *
 * Necessary because createAdminClient() bypasses RLS entirely — without
 * this, requireAdminOrManager() proves the caller's ROLE but nothing stops
 * them (accidentally, via a stale client, or a tampered direct call) from
 * wiring a profile/store to another org's department/location/manager/etc.
 * by id. Mirrors the org-scoped lookup pattern already used correctly in
 * bulkCreateUsers()'s deptByName/storeByCode maps — this just makes it
 * reusable for the single-record update paths that were missing it.
 */
export async function assertRefsInOrg(
  admin: AnyClient,
  orgId: string,
  refs: { table: string; id: string; label: string }[]
): Promise<string | null> {
  for (const { table, id, label } of refs) {
    const { data } = await admin.from(table).select('id').eq('id', id).eq('org_id', orgId).maybeSingle()
    if (!data) return `Selected ${label} not found in your organisation.`
  }
  return null
}

/**
 * The same check for the teams and people a business rule names in its actions (set_team, assign): a rule saved with another organisation's
 * ids would later write them onto this organisation's tickets with the service-role client (audit D-031).
 */
export async function assertRuleActionsInOrg(
  admin: AnyClient,
  orgId: string,
  actions: { type: string; params?: Record<string, unknown> }[] | null | undefined
): Promise<string | null> {
  const teams = new Set<string>()
  const people = new Set<string>()
  for (const a of actions ?? []) {
    if (a.type === 'set_team' && typeof a.params?.teamId === 'string' && a.params.teamId) teams.add(a.params.teamId)
    if (a.type === 'assign' && Array.isArray(a.params?.assigneeIds)) for (const id of a.params.assigneeIds) if (typeof id === 'string' && id) people.add(id)
  }
  return assertRefsInOrg(admin, orgId, [
    ...[...teams].map((id) => ({ table: 'teams', id, label: 'technician group' })),
    ...[...people].map((id) => ({ table: 'profiles', id, label: 'technician' })),
  ])
}
