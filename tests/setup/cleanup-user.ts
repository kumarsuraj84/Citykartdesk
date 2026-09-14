// Stage 5.1 — shared, throw-on-failure test-user deletion.
//
// Root-caused two independent stale-auth-user leaks (STAGE_5_REPORT.md
// "Known Gaps", growing from 5 -> 14 -> 22 across stages):
//
//   1. item6-assignment-rbac.test.ts (structural, deterministic): its
//      afterAll called `admin.auth.admin.deleteUser(agentA2.id)` BEFORE
//      `fx.cleanup()` — but agentA2 is `requests.assigned_to` on a row that
//      `fx.cleanup()` (not yet run) still hasn't deleted, and
//      `requests.assigned_to`/`requester_id` are `REFERENCES profiles(id)`
//      with NO ACTION (confirmed by direct reproduction: Supabase Auth's
//      admin deleteUser returns `{status:500, message:"Database error
//      deleting user"}` — never a thrown JS exception — whenever a
//      `requests` row still references the profile). The call's `error` was
//      never checked, so the failure was silently swallowed every time.
//
//   2. desk-uat-001-reopen.test.ts (transient, not structural): its own
//      cleanup already deletes `requests` before calling `deleteUser()`, and
//      that exact sequence reproduces cleanly with zero failures in
//      isolation — the leak only appears under the sustained sequential
//      load of the full ~550-test suite, consistent with an occasional
//      transient Auth/Postgres contention failure (also surfaced as the
//      same unchecked 500) rather than a permanent reference. A bounded
//      retry is the correct, honest response to a genuinely transient
//      infra hiccup — it is not a substitute for the structural fix above,
//      and it still throws (never silently swallows) if every attempt fails.
//
// Both call sites now route through this one helper instead of hand-rolling
// an unchecked `deleteUser()` call, and instead of a "console.error and
// move on" pattern — per the Stage 3.2 principle this project already
// established in cleanup-org.ts: a cleanup failure is a test failure, not
// something to log and ignore.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { auth: { admin: { deleteUser: (id: string) => Promise<{ data: unknown; error: { message: string } | null }> } } }

/**
 * Deletes a test-created auth user. Retries a bounded number of times on
 * failure (Supabase Auth's admin deleteUser can transiently fail under
 * sustained sequential test load — see file header), then THROWS if it
 * still hasn't succeeded — callers must not swallow this (let it propagate
 * out of `afterAll`/`finally` so the test run fails loudly rather than
 * leaking silently).
 *
 * IMPORTANT: this only retries the deletion call itself. If a user is still
 * referenced by a NO ACTION FK (e.g. requests.assigned_to/requester_id),
 * retrying will never succeed — the caller must delete those referencing
 * rows FIRST (the actual, structural fix for issue #1 above).
 */
export async function deleteTestUser(admin: AnyClient, userId: string, label?: string): Promise<void> {
  const attempts = 3
  let lastError: string | null = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (!error) return
    lastError = error.message
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 200 * attempt))
  }
  throw new Error(
    `[cleanup-user] failed to delete test user ${label ? `"${label}" ` : ''}(${userId}) after ${attempts} attempts: ${lastError} — ` +
      `if this is a NO ACTION foreign key (e.g. requests.assigned_to/requester_id), delete the referencing rows before calling deleteTestUser().`
  )
}

/** Deletes several test users, collecting every failure before throwing a
 *  single combined error — so a fixture cleaning up N users doesn't stop at
 *  the first failure and leak the rest un-attempted. */
export async function deleteTestUsers(admin: AnyClient, users: { id: string; label?: string }[]): Promise<void> {
  const results = await Promise.allSettled(users.map((u) => deleteTestUser(admin, u.id, u.label)))
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failures.length > 0) {
    throw new Error(`[cleanup-user] ${failures.length}/${users.length} user deletions failed:\n${failures.map((f) => f.reason).join('\n')}`)
  }
}
