// A user linked to a store (a store logs in as one) is never an approver: no store is authorised to approve anything, and nothing (a technician's "Send for approval", the automatic CVM
// approval, a delegation, an approval flow) may ever be sent to one. Head-office requesters are ordinary users with no store link: they CAN be approvers.
// One rule, used by every place that chooses an approver; the pickers also leave store users out of their lists (`.is('store_id', null)`).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = { from: (t: string) => any }

export const STORE_APPROVER_MESSAGE = 'A store user cannot be an approver. Please choose a head-office person.'

/** The ids (of those given) that belong to a user linked to a store. An empty list, or a failed read, gives []. */
export async function storeLinkedAmong(db: DbLike, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return []
  const { data, error } = await db.from('profiles').select('id, store_id').in('id', unique)
  if (error) throw new Error(`could not check the approvers: ${error.message}`)
  return ((data ?? []) as { id: string; store_id: string | null }[]).filter((p) => !!p.store_id).map((p) => p.id)
}

/** The refusal text when any of the people is a store user, else null. Reads the database, so a failed read refuses rather than lets a store user through. */
export async function barStoreApprovers(db: DbLike, ids: string[]): Promise<string | null> {
  try {
    return (await storeLinkedAmong(db, ids)).length > 0 ? STORE_APPROVER_MESSAGE : null
  } catch {
    return 'The approvers could not be checked right now. Please try again.'
  }
}

/** Whether the Approvals menu entry is shown: the module is on, and the person is not a store user - unless an approval is actually waiting for them (it must never be hidden from someone who has one). */
export function showApprovalsMenu(o: { moduleOn: boolean; storeLinked: boolean; waiting: number }): boolean {
  return o.moduleOn && (!o.storeLinked || o.waiting > 0)
}
