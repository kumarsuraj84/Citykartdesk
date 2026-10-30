import type { ProgramRowRecord } from './mail'

// The machine list of a Vendor Program whose sheet has one row per machine (for example AC): the store's machines as the choices of a ticket form's dropdown, the choice
// checked on the server, and the one chosen machine found again. Pure functions (no database) plus one loader.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type MachineOption = { value: string; label: string }

type MachineLike = Pick<ProgramRowRecord, 'id' | 'machine_no' | 'serial'> & { sheet_row?: number | null; /** set by withMachineKeys when the machine number is shared with another row */ machine_key?: string }

/** The plain value of a machine: its machine number, else its serial number, else its row. */
const baseValueOf = (r: MachineLike): string => (r.machine_no ?? '').trim() || (r.serial ?? '').trim() || r.id

/** The value a machine is chosen by: its machine number, else its serial number, else its row (a second row with the same number carries its serial too, see withMachineKeys). */
export const machineValueOf = (r: MachineLike): string => (r.machine_key ?? '').trim() || baseValueOf(r)

/**
 * Gives every row its own choice. Two rows can have the same machine number (a typing mistake in the sheet, or two real machines): both are KEPT, the first keeps the plain number
 * (so a choice saved earlier still points to it) and each later one is shown with its serial, "7 (SN-2)", or its sheet row when it has no serial. Without this the second machine
 * could never be chosen and its addresses were unreachable.
 */
export function withMachineKeys<T extends MachineLike>(rows: T[]): T[] {
  const used = new Set<string>()
  return rows.map((r) => {
    const base = baseValueOf(r)
    const free = (k: string) => !used.has(k.toLowerCase())
    let key = base
    if (!free(key)) {
      const serial = (r.serial ?? '').trim()
      const candidates = [serial && serial.toLowerCase() !== base.toLowerCase() ? `${base} (${serial})` : '', `${base} (row ${r.sheet_row ?? r.id.slice(0, 8)})`, `${base} (${r.id})`].filter(Boolean)
      key = candidates.find(free) ?? `${base} (${r.id})`
    }
    used.add(key.toLowerCase())
    return key === base && !r.machine_key ? r : { ...r, machine_key: key }
  })
}

/**
 * The requester reads ONLY the machine's own number in the dropdown (for AC: the CKDESK serial no of the sheet), never floor, brand or other sheet details, so nobody is
 * confused. Everything else in the sheet is for the mail, reports and dashboards.
 */
export function machineOptions(rows: ProgramRowRecord[]): MachineOption[] {
  // every row is a choice; rows that share a machine number are told apart by their serial (the sheet check also warns about the repeated number)
  return withMachineKeys(rows).map((r) => { const value = machineValueOf(r); return { value, label: value } })
}

/** The row a saved choice points to (case does not matter); null when it is not one of the given machines. */
export function findSelectedMachine(rows: ProgramRowRecord[], value: string | null | undefined): ProgramRowRecord | null {
  const v = (value ?? '').trim().toLowerCase()
  if (!v) return null
  const keyed = withMachineKeys(rows) as (ProgramRowRecord & { machine_key?: string })[]
  // the returned row carries its own choice value (machine_key), so machineValueOf() of it points back to exactly this machine
  return keyed.find((r) => machineValueOf(r).toLowerCase() === v)
    ?? keyed.find((r) => (r.machine_no ?? '').trim().toLowerCase() === v)   // a choice saved before the number was shared: the first row with it
    ?? keyed.find((r) => (r.serial ?? '').trim().toLowerCase() === v) ?? null
}

const ROW_COLUMNS = 'id, store_code, machine_no, serial, vendor, emails, po_emails, approver_emails, extra, is_active, sheet_row'

/**
 * For the store's ticket form: for every category of an ACTIVE program with one row per machine, the store's machines (an empty list when the store has none). A category
 * that is not in such a program is not in the answer, so the form hides the machine box for it.
 */
export async function loadMachineOptionsForStore(db: Db, orgId: string, storeCode: string): Promise<Record<string, MachineOption[]>> {
  const { data: programs } = await db.from('vendor_programs').select('id').eq('org_id', orgId).eq('is_active', true).eq('row_type', 'machine')
  const list = (programs ?? []) as { id: string }[]
  if (list.length === 0) return {}
  const out: Record<string, MachineOption[]> = {}
  for (const p of list) {
    const [{ data: cats }, { data: rows }] = await Promise.all([
      db.from('service_categories').select('id').eq('org_id', orgId).eq('program_id', p.id),
      db.from('program_rows').select(ROW_COLUMNS).eq('org_id', orgId).eq('program_id', p.id).eq('store_code', storeCode.toUpperCase()).eq('is_active', true).is('removed_at', null).order('sheet_row', { ascending: true }),
    ])
    const options = machineOptions((rows ?? []) as ProgramRowRecord[])
    for (const c of (cats ?? []) as { id: string }[]) out[c.id] = options
  }
  return out
}
