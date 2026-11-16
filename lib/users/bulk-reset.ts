import type { UserRole } from '@/types'

// Shared by the bulk password reset server actions and their dialog. Kept out of the
// 'use server' file because such a file may only export async functions.

/** Users processed per request, so the dialog can show progress and no single call runs long. */
export const BULK_RESET_BATCH_SIZE = 40

/** Roles a bulk reset may touch — admins and platform owners are always left alone. */
export const BULK_RESET_ROLES: UserRole[] = ['user', 'agent', 'manager']

/**
 * The roles THIS caller may bulk-reset. A platform owner may also reset administrators (only a platform owner may change an
 * "admin" account at all — lib/admin/target-guard.ts, audit D-009); a plain administrator may not, so for them the list is
 * the base one. A platform owner is never in the list for anybody, and the caller's own account is excluded separately.
 */
export function bulkResetRolesFor(callerRole: string | null | undefined): UserRole[] {
  return callerRole === 'platform_owner' ? [...BULK_RESET_ROLES, 'admin'] : BULK_RESET_ROLES
}

/**
 * How the new passwords are made.
 *  - 'random' (the default, and what audit A-05 asks for): each account gets its own one-time password.
 *  - 'shared': one password, typed by the administrator, set on every account. Easier to hand out to a whole company at once
 *    (a roll-out, a training day), but until a person changes it, anybody who knows it can sign in as them — so it is only
 *    ever chosen deliberately, and it is written into the audit log as a shared reset.
 */
export type BulkResetMode = 'random' | 'shared'

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
