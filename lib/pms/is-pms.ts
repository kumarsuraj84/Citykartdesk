import 'server-only'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

/** True when the ticket is an AC PMS ticket (its category is marked "AC PMS category"). Used where the vendor's steps differ for PMS: no OEM ticket number, a PMS report. */
export async function isPmsRequest(db: Db, requestId: string): Promise<boolean> {
  const { data: r } = await db.from('requests').select('category_id').eq('id', requestId).maybeSingle()
  if (!r?.category_id) return false
  const { data: c } = await db.from('service_categories').select('is_pms').eq('id', r.category_id).maybeSingle()
  return c?.is_pms === true
}
