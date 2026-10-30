// The machine / line a ticket is about, when it is not an AC: the sheet row of its Vendor Program, saved with the ticket (request_program_snapshots).
// The vendor portal and the quote / PO approval read it the same way they read the AC row of an AC ticket (request_master_snapshots, kind 'ac'); this file is only
// used when a ticket has no AC row, so nothing about AC tickets changes.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type ProgramAssetRow = {
  id?: string
  store_code?: string
  vendor?: string | null
  machine_no?: string | null
  serial?: string | null
  emails: string[]
  po_emails: string[]
  approver_emails: string[]
  extra?: Record<string, string> | null
}

export type ProgramAsset = {
  /** every row saved with the ticket (the mail went to all of them) */
  rows: ProgramAssetRow[]
  programId: string
  programName: string
  /** the fixed list of resolutions the vendor chooses from ("Other" is always added by the screen) */
  resolutionOptions: string[]
  /** the vendor must enter the OEM ticket number to start (a switch of the program; AC always needs it) */
  oemNumberRequired: boolean
  /** the program's own default PO approvers (profile ids), used when the row names none */
  defaultApproverIds: string[]
  /**
   * The row the PO mail and the quote approvers are taken from: the row of the assigned technician's own company (matched by vendor name) when the ticket has several rows; the
   * only row when there is one; else a row that holds the UNION of every row's addresses (no id, so it is never read live by id).
   */
  row: ProgramAssetRow | null
  /** what the screens and mails call this machine: the program name, with the machine / serial when the sheet has one */
  label: string
}

export function assetLabelOf(programName: string, row: ProgramAssetRow | null): string {
  const id = [row?.machine_no, row?.serial].map((v) => (v ?? '').trim()).filter(Boolean).join(' / ')
  return id ? `${programName} - ${id}` : programName
}

const squash = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** The sheet's vendor name and the vendor company's name are the same company (spelling, spaces and punctuation do not matter; one may contain the other: "Aqua Care" / "Aqua Care Pvt Ltd"). */
export function sameVendor(sheetVendor: string | null | undefined, companyName: string | null | undefined): boolean {
  const a = squash(sheetVendor); const b = squash(companyName)
  if (!a || !b) return false
  return a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)))
}

const union = (lists: (string[] | null | undefined)[]) => [...new Set(lists.flatMap((l) => l ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))]

/** Pure: which saved row the PO side (PO mail, quote approvers) uses. */
export function chooseAssetRow(rows: ProgramAssetRow[], vendorName?: string | null): ProgramAssetRow | null {
  const norm = (r: ProgramAssetRow): ProgramAssetRow => ({ ...r, emails: r.emails ?? [], po_emails: r.po_emails ?? [], approver_emails: r.approver_emails ?? [] })
  if (rows.length === 0) return null
  if (rows.length === 1) return norm(rows[0])
  const own = vendorName ? rows.filter((r) => sameVendor(r.vendor, vendorName)) : []
  if (own.length === 1) return norm(own[0])
  const pool = own.length > 1 ? own : rows
  // several rows and no single one to prefer: the mail to the OEM went to every row, so the PO mail and the approvers are the union of all of them
  return { ...norm(pool[0]), id: undefined, emails: union(pool.map((r) => r.emails)), po_emails: union(pool.map((r) => r.po_emails)), approver_emails: union(pool.map((r) => r.approver_emails)) }
}

/** The name of the vendor company of the technician the ticket is assigned to (null when it is not with a vendor). */
export async function vendorNameOfTicket(db: Db, requestId: string): Promise<string | null> {
  const { data: r } = await db.from('requests').select('assigned_to').eq('id', requestId).maybeSingle()
  if (!r?.assigned_to) return null
  const { data: p } = await db.from('profiles').select('vendor_company_id').eq('id', r.assigned_to).maybeSingle()
  if (!p?.vendor_company_id) return null
  const { data: c } = await db.from('vendor_companies').select('name').eq('id', p.vendor_company_id).maybeSingle()
  return (c?.name as string | undefined) ?? null
}

/**
 * The program a ticket was sent through, with its saved sheet row; null for a ticket that is not a program ticket. A ticket can hold a saved copy for more than one program (its
 * category was moved): the copy of the program its CATEGORY belongs to is the one used. `vendorName` (the assigned technician's company) picks the row when the ticket has several.
 */
export async function loadProgramAsset(db: Db, requestId: string, opts: { vendorName?: string | null } = {}): Promise<ProgramAsset | null> {
  const { data: snaps } = await db.from('request_program_snapshots').select('program_id, snapshot').eq('request_id', requestId)
  const list = (snaps ?? []) as { program_id: string | null; snapshot: unknown }[]
  let snap = list[0]
  if (list.length > 1) {
    const { data: r } = await db.from('requests').select('category_id').eq('id', requestId).maybeSingle()
    const { data: cat } = r?.category_id ? await db.from('service_categories').select('program_id').eq('id', r.category_id).maybeSingle() : { data: null }
    snap = list.find((s) => s.program_id && s.program_id === cat?.program_id) ?? list[0]
  }
  if (!snap?.program_id) return null
  const { data: prog } = await db.from('vendor_programs').select('id, name, resolution_options, oem_number_required, default_approver_ids').eq('id', snap.program_id).maybeSingle()
  if (!prog) return null
  const rows = (Array.isArray(snap.snapshot) ? snap.snapshot : []) as ProgramAssetRow[]
  const row = chooseAssetRow(rows, opts.vendorName)
  return { rows, programId: prog.id as string, programName: prog.name as string, resolutionOptions: (prog.resolution_options ?? []) as string[], oemNumberRequired: prog.oem_number_required === true, defaultApproverIds: (prog.default_approver_ids ?? []) as string[], row, label: assetLabelOf(prog.name as string, row) }
}

/** The approver addresses of the row: read live from the program's sheet copy by row id, with the copy saved on the ticket as the fallback (the row may have left the sheet). */
export async function liveApproverEmails(db: Db, asset: ProgramAsset): Promise<string[]> {
  const saved = asset.row?.approver_emails ?? []
  if (!asset.row?.id) {
    // the union of several rows: each row is read live by its id (the saved copy where the row has left the sheet), then joined
    const ids = asset.rows.map((r) => r.id).filter((x): x is string => !!x)
    if (ids.length === 0) return saved
    const { data: live } = await db.from('program_rows').select('id, approver_emails').in('id', ids).is('removed_at', null)
    const liveById = new Map(((live ?? []) as { id: string; approver_emails: string[] | null }[]).map((r) => [r.id, r.approver_emails ?? []]))
    return union(asset.rows.map((r) => (r.id && liveById.has(r.id) ? liveById.get(r.id) : r.approver_emails)))
  }
  const { data: live } = await db.from('program_rows').select('approver_emails').eq('id', asset.row.id).is('removed_at', null).maybeSingle()
  return live ? ((live.approver_emails as string[] | null) ?? []) : saved
}
