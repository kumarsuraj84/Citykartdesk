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
  programId: string
  programName: string
  /** the fixed list of resolutions the vendor chooses from ("Other" is always added by the screen) */
  resolutionOptions: string[]
  /** the vendor must enter the OEM ticket number to start (a switch of the program; AC always needs it) */
  oemNumberRequired: boolean
  /** the program's own default PO approvers (profile ids), used when the row names none */
  defaultApproverIds: string[]
  row: ProgramAssetRow | null
  /** what the screens and mails call this machine: the program name, with the machine / serial when the sheet has one */
  label: string
}

export function assetLabelOf(programName: string, row: ProgramAssetRow | null): string {
  const id = [row?.machine_no, row?.serial].map((v) => (v ?? '').trim()).filter(Boolean).join(' / ')
  return id ? `${programName} - ${id}` : programName
}

/** The program a ticket was sent through, with its saved sheet row; null for a ticket that is not a program ticket. */
export async function loadProgramAsset(db: Db, requestId: string): Promise<ProgramAsset | null> {
  const { data: snap } = await db.from('request_program_snapshots').select('program_id, snapshot').eq('request_id', requestId).maybeSingle()
  if (!snap?.program_id) return null
  const { data: prog } = await db.from('vendor_programs').select('id, name, resolution_options, oem_number_required, default_approver_ids').eq('id', snap.program_id).maybeSingle()
  if (!prog) return null
  const rows = (Array.isArray(snap.snapshot) ? snap.snapshot : []) as ProgramAssetRow[]
  const row = rows[0] ? { ...rows[0], emails: rows[0].emails ?? [], po_emails: rows[0].po_emails ?? [], approver_emails: rows[0].approver_emails ?? [] } : null
  return { programId: prog.id as string, programName: prog.name as string, resolutionOptions: (prog.resolution_options ?? []) as string[], oemNumberRequired: prog.oem_number_required === true, defaultApproverIds: (prog.default_approver_ids ?? []) as string[], row, label: assetLabelOf(prog.name as string, row) }
}

/** The approver addresses of the row: read live from the program's sheet copy by row id, with the copy saved on the ticket as the fallback (the row may have left the sheet). */
export async function liveApproverEmails(db: Db, asset: ProgramAsset): Promise<string[]> {
  const saved = asset.row?.approver_emails ?? []
  if (!asset.row?.id) return saved
  const { data: live } = await db.from('program_rows').select('approver_emails').eq('id', asset.row.id).is('removed_at', null).maybeSingle()
  return live ? ((live.approver_emails as string[] | null) ?? []) : saved
}
