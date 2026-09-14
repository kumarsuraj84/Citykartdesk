// Stage 3.2 — shared cleanup for a test-created secondary ("Org B")
// organization. A `seed_org_sla_config` trigger (migration
// 20240101000048_per_org_sla_config.sql) auto-populates a `global_sla_config`
// row for every new `organizations` row, and `global_sla_config_org_id_fkey`
// is `ON DELETE NO ACTION` — so an org can never be deleted until that row is
// cleared first. Every existing cross-org test fixture missed this (the org
// silently stayed behind after each run), which is why the local test DB can
// accumulate stray organizations over time — see STAGE_3_2_REPORT.md "Root
// Cause Confirmed".
//
// This helper only handles that one universally-missed, non-obvious
// dependency. Callers remain responsible for deleting their OWN org-scoped
// entities (teams, services, categories, departments, profiles, auth users,
// …) before calling this, the same way they already do today.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

/**
 * Deletes a test-created organization, including its auto-created
 * `global_sla_config` row(s). Throws (rather than swallowing the error) if
 * the org still can't be deleted afterward — a fixture that hasn't finished
 * clearing its own org-scoped rows should fail loudly in `afterAll`, not
 * leak the org silently the way every affected fixture did before this
 * stage.
 */
export async function deleteTestOrg(admin: AnyClient, orgId: string): Promise<void> {
  await admin.from('global_sla_config').delete().eq('org_id', orgId)
  const { error } = await admin.from('organizations').delete().eq('id', orgId)
  if (error) {
    throw new Error(
      `[cleanup-org] failed to delete test org ${orgId}: ${error.message} — another org-scoped row (services/teams/departments/profiles/...) likely still references it; delete those before calling deleteTestOrg().`
    )
  }
}

/** True if `orgId` still exists — for asserting a cleanup actually worked,
 *  rather than only checking that the delete call didn't return an error. */
export async function orgExists(admin: AnyClient, orgId: string): Promise<boolean> {
  const { data } = await admin.from('organizations').select('id').eq('id', orgId).maybeSingle()
  return !!data
}

/** True if a `global_sla_config` row still exists for `orgId`. */
export async function globalSlaConfigExists(admin: AnyClient, orgId: string): Promise<boolean> {
  const { data } = await admin.from('global_sla_config').select('id').eq('org_id', orgId).limit(1)
  return (data?.length ?? 0) > 0
}
