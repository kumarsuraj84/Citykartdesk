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
