import { splitRecipients } from './emails'

// Lookups the ticket form and the ticket creation use. They read CK Desk's own copy of the sheets (never Google), through the server's client.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type AcUnitRecord = {
  id: string
  store_code: string
  ckdesk_no: string
  serial: string | null
  floor: string | null
  ac_type: string | null
  tonnage: string | null
  brand: string | null
  amc_vendor: string | null
  amc_brand: string | null
  is_active: boolean
  emails: string[]
  /** the OEM's address(es) for purchase-order details (AC sheet column "OEM PO Mail To"); empty when the sheet has none */
  po_emails?: string[]
  /** the Citykart people who approve a vendor's quote for this AC (AC sheet column "CK PO Approver Mail To"); empty = the default approver */
  approver_emails?: string[]
  sheet_row: number | null
  address: string | null
  /** where the store is (used by Business Rules to route a ticket to the right vendor technician) */
  region?: string | null
  cluster?: string | null
  state?: string | null
}

export type GensetRecord = {
  id: string
  store_code: string
  brand: string | null
  kva: string | null
  serial: string | null
  cpcb_group: string | null
  emails: string[]
}

export type AcOption = { value: string; label: string; unitId: string }

function numericFirst(a: string, b: string): number {
  const na = Number(a), nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a.localeCompare(b, undefined, { numeric: true })
}

const AC_COLS = 'id, store_code, ckdesk_no, serial, floor, ac_type, tonnage, brand, amc_vendor, amc_brand, is_active, emails, po_emails, approver_emails, sheet_row, address, region, cluster, state'

/** The AC units a store may pick when raising a ticket: Active and still in the sheet. */
export async function loadActiveAcUnits(db: Db, orgId: string, storeCode: string): Promise<AcUnitRecord[]> {
  const { data } = await db.from('master_ac_units').select(AC_COLS).eq('org_id', orgId).eq('store_code', storeCode.toUpperCase()).eq('is_active', true).is('removed_at', null)
  return ((data ?? []) as AcUnitRecord[]).sort((a, b) => numericFirst(a.ckdesk_no, b.ckdesk_no))
}

/** The value saved in the ticket for a unit: its CKDESK number; when two active units of a store share a number, the serial is added so they can be told apart. */
export function acOptionsFor(units: AcUnitRecord[]): AcOption[] {
  const count = new Map<string, number>()
  for (const u of units) count.set(u.ckdesk_no, (count.get(u.ckdesk_no) ?? 0) + 1)
  return units.map((u) => {
    const dup = (count.get(u.ckdesk_no) ?? 0) > 1
    const hint = [u.floor, [u.ac_type, u.tonnage].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    const value = dup ? `${u.ckdesk_no} (${u.serial || `row ${u.sheet_row ?? '?'}`})` : u.ckdesk_no
    return { value, label: hint ? `${value} - ${hint}` : value, unitId: u.id }
  })
}

export async function loadAcOptionsForStoreCode(db: Db, orgId: string, storeCode: string): Promise<AcOption[]> {
  return acOptionsFor(await loadActiveAcUnits(db, orgId, storeCode))
}

/** The unit a saved ticket value points to (null when the value is not one of the store's active units). */
export function findSelectedUnit(units: AcUnitRecord[], value: string | null | undefined): AcUnitRecord | null {
  const v = (value ?? '').trim()
  if (!v) return null
  const opts = acOptionsFor(units)
  const hit = opts.find((o) => o.value.toLowerCase() === v.toLowerCase())
  return hit ? units.find((u) => u.id === hit.unitId) ?? null : null
}

export async function loadGensetsForStore(db: Db, orgId: string, storeCode: string): Promise<GensetRecord[]> {
  const { data } = await db.from('master_gensets').select('id, store_code, brand, kva, serial, cpcb_group, emails').eq('org_id', orgId).eq('store_code', storeCode.toUpperCase()).is('removed_at', null).order('sheet_row')
  return (data ?? []) as GensetRecord[]
}

export type MailTarget = { to: string[]; cc: string[] }

/** Who an AC ticket is mailed to: the addresses of the chosen unit. Without a choice, or when that unit has no address, the other active units of the store are used. */
export function acMailTarget(units: AcUnitRecord[], selected: AcUnitRecord | null): MailTarget | null {
  const pool = selected?.emails.length ? selected.emails : units.flatMap((u) => u.emails)
  return pool.length ? splitRecipients(pool) : null
}

/** Who a Genset ticket is mailed to: the addresses of every genset row of the store, in one mail. */
export function gensetMailTarget(gensets: GensetRecord[]): MailTarget | null {
  const pool = gensets.flatMap((g) => g.emails)
  return pool.length ? splitRecipients(pool) : null
}

/** The CVM e-mail of a store (null when the sheet has none for it). */
export async function loadCvmEmail(db: Db, orgId: string, storeCode: string): Promise<string | null> {
  const { data } = await db.from('master_store_cvm').select('cvm_email').eq('org_id', orgId).eq('store_code', storeCode.toUpperCase()).is('removed_at', null).maybeSingle()
  return (data?.cvm_email as string | undefined) ?? null
}
