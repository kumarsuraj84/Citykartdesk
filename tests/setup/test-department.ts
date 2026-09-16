import type { createAdminClient } from '@/lib/supabase/admin'

// Shared helper so every integration test creates and tears down its own
// department row instead of depending on a specific pre-existing one
// (department IDs are not seed/bootstrap data - deleting one in a cleanup
// pass elsewhere in the suite must never break an unrelated test).

export async function createTestDepartment(
  admin: ReturnType<typeof createAdminClient>,
  name: string,
  orgId: string
): Promise<string> {
  const { data, error } = await admin.from('departments').insert({ name, org_id: orgId }).select('id').single()
  if (error || !data) throw new Error(`[test-department] failed to create "${name}": ${error?.message}`)
  return data.id
}

/** Delete only after every profiles.department_id / teams.department_id
 *  reference to it (i.e. the test users and teams that used it) is gone. */
export async function deleteTestDepartment(
  admin: ReturnType<typeof createAdminClient>,
  departmentId: string
): Promise<void> {
  const { error } = await admin.from('departments').delete().eq('id', departmentId)
  if (error) throw new Error(`[test-department] failed to delete ${departmentId}: ${error.message}`)
}
