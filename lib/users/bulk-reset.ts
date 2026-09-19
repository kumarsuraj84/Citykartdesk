import type { UserRole } from '@/types'

// Shared by the bulk password reset server actions and their dialog. Kept out of the
// 'use server' file because such a file may only export async functions.

/** Users processed per request, so the dialog can show progress and no single call runs long. */
export const BULK_RESET_BATCH_SIZE = 40

/** Roles a bulk reset may touch — admins and platform owners are always left alone. */
export const BULK_RESET_ROLES: UserRole[] = ['user', 'agent', 'manager']

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
