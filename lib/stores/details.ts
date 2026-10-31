// The store card (the `stores` table) is the ONE main master of a store's standard details: address, pincode, city, state, region, cluster, priority list, festival, opening date.
// The AC sheet and the Store Master import fill it; every ticket of the store (any service, with or without a Vendor Program) reads it from here: the Business Rules, the mails and the
// address shown on the ticket. Pure helpers (no server-only import), safe to load in the browser (the mail editors list the fields from here); the loader takes the database client.

export const STORE_DETAIL_COLUMNS = 'code, address, pincode, city, state, region, cluster, priority_list, festival, open_date'

/** The store details a mail can use: `{{store_city}}`, `{{store_state}}`, ... (the address is `{{store_address}}`, with the pincode already in it). */
export const STORE_MAIL_FIELDS = ['store_city', 'store_state', 'store_region', 'store_cluster', 'store_priority', 'store_festival', 'store_open_date'] as const

export const STORE_SAMPLE_VALUES: Record<string, string> = {
  store_city: 'Allahabad', store_state: 'Uttar Pradesh', store_region: 'North', store_cluster: 'UP-2', store_priority: 'P1', store_festival: 'Diwali', store_open_date: '12 Mar 2024',
}

export type StoreRowLike = {
  code?: string | null
  address?: string | null
  pincode?: string | null
  city?: string | null
  state?: string | null
  region?: string | null
  cluster?: string | null
  priority_list?: string | null
  festival?: string | null
  open_date?: string | null
}

export type StoreFacts = {
  code: string
  /** the address with the pincode at its end (see addressWithPincode) */
  address: string
  city: string
  state: string
  region: string
  cluster: string
  priority: string
  festival: string
  /** the opening date as written in the store card (yyyy-mm-dd), '' when unknown */
  openDate: string
  /** whole months since the store opened, null when the opening date is unknown */
  openMonths: number | null
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

/**
 * The address with the pincode at its end, written once: "Main Road, Allahabad - 211001". The pincode is NOT added when it is empty, when the address is empty
 * (there is nothing to complete), or when the address already contains it (the sheets often have it typed in the address).
 */
export function addressWithPincode(address: string | null | undefined, pincode: string | null | undefined): string {
  const a = text(address)
  const p = text(pincode)
  if (!a) return ''
  if (!p) return a
  if (a.replace(/\s+/g, '').includes(p.replace(/\s+/g, ''))) return a
  return `${a.replace(/[\s,;-]+$/, '')} - ${p}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2024-03-12" -> "12 Mar 2024" (written by hand: no time zone can shift the day). Anything else is returned as it is. */
export function formatOpenDate(openDate: string | null | undefined): string {
  const v = text(openDate)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (!m) return v
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${Number(m[3])} ${month} ${m[1]}` : v
}

/** Whole months from the opening date to `now` (a date not reached yet counts as 0). null when there is no usable opening date. */
export function monthsSince(openDate: string | null | undefined, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(openDate))
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  let months = (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - mo)
  if (now.getUTCDate() < d) months -= 1
  return Math.max(0, months)
}

export function storeFactsFromRow(row: StoreRowLike | null | undefined, now: Date = new Date()): StoreFacts | null {
  if (!row) return null
  return {
    code: text(row.code).toUpperCase(),
    address: addressWithPincode(row.address, row.pincode),
    city: text(row.city), state: text(row.state), region: text(row.region), cluster: text(row.cluster),
    priority: text(row.priority_list), festival: text(row.festival),
    openDate: text(row.open_date), openMonths: monthsSince(row.open_date, now),
  }
}

/** The values the mail templates use for the store; every field is present (empty when the store card has nothing), so a template never prints "undefined". */
export function storeMailFields(facts: StoreFacts | null): Record<string, string> {
  return {
    store_city: facts?.city ?? '', store_state: facts?.state ?? '', store_region: facts?.region ?? '', store_cluster: facts?.cluster ?? '',
    store_priority: facts?.priority ?? '', store_festival: facts?.festival ?? '', store_open_date: formatOpenDate(facts?.openDate),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbLike = { from: (t: string) => any }

/** The store card of a store, by its id or its code. null when there is no such store (or the read failed: the caller then simply has no store details). */
export async function loadStoreFacts(db: DbLike, orgId: string, by: { id?: string | null; code?: string | null }, now: Date = new Date()): Promise<StoreFacts | null> {
  if (!by.id && !by.code) return null
  let q = db.from('stores').select(STORE_DETAIL_COLUMNS).eq('org_id', orgId)
  q = by.id ? q.eq('id', by.id) : q.eq('code', String(by.code).toUpperCase())
  const { data, error } = await q.maybeSingle()
  if (error || !data || Array.isArray(data)) return null
  return storeFactsFromRow(data as StoreRowLike, now)
}
