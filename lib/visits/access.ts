import { createHash } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { isOverLimit, recordEvent } from '@/lib/rate-limit'
import { visitCodeValid } from './code'

// Who may use the public engineer page: somebody who knows a store code AND that store's visit code of the day. No account is involved, so the only things in the
// way of a guesser are the six-digit code, a lock after five wrong tries for that store (15 minutes), and the fact that the store must still confirm.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

const LOCK_AFTER = 5
const LOCK_WINDOW_MS = 15 * 60_000

export type EngineerAccess =
  | { ok: true; orgId: string; storeCode: string; storeName: string }
  | { ok: false; status: 400 | 401 | 429 | 503; error: string }

const WRONG = 'The store code or the visit code is not correct. Ask the store manager for today\'s visit code.'

export async function checkEngineerAccess(storeCodeRaw: unknown, codeRaw: unknown, now: Date = new Date()): Promise<EngineerAccess> {
  const storeCode = String(storeCodeRaw ?? '').trim().toUpperCase().slice(0, 30)
  const code = String(codeRaw ?? '')
  if (!storeCode || !/^[A-Z0-9_-]+$/.test(storeCode)) return { ok: false, status: 400, error: 'Please enter the store code.' }
  const failKey = `visit-fail:${storeCode}`
  if (isOverLimit(failKey, LOCK_AFTER)) return { ok: false, status: 429, error: 'Too many wrong codes for this store. Please try again in 15 minutes, or ask the store manager.' }

  const db = createAdminClient() as unknown as Db
  const { data: stores } = await db.from('stores').select('org_id, name').eq('code', storeCode).eq('is_active', true).limit(2)
  const list = (stores ?? []) as { org_id: string; name: string }[]
  // an unknown store and a wrong code look the same, so the page cannot be used to find out which store codes exist
  if (list.length !== 1 || !visitCodeValid(list[0].org_id, storeCode, code, now)) {
    recordEvent(failKey, LOCK_WINDOW_MS)
    return { ok: false, status: 401, error: WRONG }
  }
  return { ok: true, orgId: list[0].org_id, storeCode, storeName: list[0].name }
}

export const hashIp = (ip: string | null) => (ip ? createHash('sha256').update(ip).digest('hex').slice(0, 16) : null)
