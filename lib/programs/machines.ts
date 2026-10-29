import type { ProgramRowRecord } from './mail'

// The machine list of a Vendor Program whose sheet has one row per machine (for example AC): the store's machines as the choices of a ticket form's dropdown, the choice
// checked on the server, and the one chosen machine found again. Pure functions (no database) plus one loader.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type MachineOption = { value: string; label: string }

/** The value a machine is chosen by: its machine number, else its serial number, else its row. */
export const machineValueOf = (r: Pick<ProgramRowRecord, 'id' | 'machine_no' | 'serial'>): string => (r.machine_no ?? '').trim() || (r.serial ?? '').trim() || r.id

/**
 * The requester reads ONLY the machine's own number in the dropdown (for AC: the CKDESK serial no of the sheet), never floor, brand or other sheet details, so nobody is
 * confused. Everything else in the sheet is for the mail, reports and dashboards.
 */
export function machineOptions(rows: ProgramRowRecord[]): MachineOption[] {
  const seen = new Set<string>()
  const out: MachineOption[] = []
  for (const r of rows) {
    const value = machineValueOf(r)
    const key = value.toLowerCase()
    if (seen.has(key)) continue          // two rows with the same machine number: one choice (the sheet check already warns about it)
    seen.add(key)
    out.push({ value, label: value })
  }
  return out
}

/** The row a saved choice points to (case does not matter); null when it is not one of the given machines. */
export function findSelectedMachine(rows: ProgramRowRecord[], value: string | null | undefined): ProgramRowRecord | null {
  const v = (value ?? '').trim().toLowerCase()
  if (!v) return null
  return rows.find((r) => machineValueOf(r).toLowerCase() === v) ?? rows.find((r) => (r.serial ?? '').trim().toLowerCase() === v) ?? null
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
