// Vendor Programs (docs/VENDOR-PROGRAMS-DESIGN.md): the shared words of the engine. Safe to load in the browser (no server-only library).

export type ProgramRowType = 'store' | 'machine'
export type ProgramLevel = 'mail' | 'portal'

/** The meanings a sheet column can have. Every other column is kept as an "extra detail". */
export const PROGRAM_FIELDS = ['store', 'mail', 'vendor', 'machine', 'serial', 'poMail', 'approverMail', 'active'] as const
export type ProgramField = (typeof PROGRAM_FIELDS)[number]

export const FIELD_LABEL: Record<ProgramField, string> = {
  store: 'Store code', mail: 'Mail to (the vendor / OEM)', vendor: 'Vendor name', machine: 'Machine number', serial: 'Serial number',
  poMail: 'PO mail to', approverMail: 'PO approver mail to', active: 'Active',
}

/** The headings a sheet may already use for each meaning, the first one is the name shown to the administrator. Headings are matched ignoring case, spaces and punctuation. */
export const DEFAULT_HEADINGS: Record<ProgramField, readonly string[]> = {
  store: ['Store Code', 'Store'],
  mail: ['Ticket Mail To', 'Mail To', 'OEM Ticket Mail To', 'Mail ID', 'Vendor Mail To'],
  vendor: ['Vendor', 'Vendor Name'],
  machine: ['Machine No', 'Machine Number', 'Asset No', 'Asset Number'],
  serial: ['Serial No', 'Serial Number', 'Serial', 'Genset Serial No', 'AC Serial No'],
  poMail: ['PO Mail To', 'OEM PO Mail To', 'Email for PO detail'],
  approverMail: ['Quote Approver Mail To', 'Quote Approval Mail To', 'PO Approver Mail To', 'CK PO Approver Mail To'],
  active: ['Active', 'Is Active'],
}

/** The heading names an administrator typed for some meanings (empty or missing = the defaults). */
export type ProgramColumns = Partial<Record<ProgramField, string>>

export type ProgramRecord = {
  id: string
  org_id: string
  name: string
  slug: string
  is_active: boolean
  level: ProgramLevel
  row_type: ProgramRowType
  spreadsheet_id: string | null
  tab_name: string | null
  columns: ProgramColumns | null
  mail_subject: string | null
  mail_body_html: string | null
  last_checked_at: string | null
  last_applied_at: string | null
  last_status: 'ok' | 'error' | null
  last_error: string | null
  row_count: number | null
  content_hash: string | null
  /** the fixed list of resolutions a vendor chooses from when resolving a ticket of this program ("Other" is always offered too) */
  resolution_options?: string[] | null
  /** portal level: the vendor must enter the OEM ticket number to start work (default off; AC always needs it) */
  oem_number_required?: boolean | null
  /** portal level: the program's own default PO approvers, used when the sheet row names no active approver (any one decides) */
  default_approver_ids?: string[] | null
  /** how one row (machine) of the store is written in {{details}}, for example "{{extra_gensetbrand}} {{extra_gensetkva}} KVA, serial {{serial}}"; empty = the usual short wording */
  details_template?: string | null
}

export type ProgramIssue = { severity: 'error' | 'warning'; code: string; storeCode: string | null; sheetRow: number | null; message: string; token?: string }

export type ParsedProgramRow = {
  sheetRow: number
  storeCode: string
  machineNo: string
  serial: string
  vendor: string
  emails: string[]
  poEmails: string[]
  approverEmails: string[]
  isActive: boolean
  extra: Record<string, string>
}

export type ProgramParseResult = { rows: ParsedProgramRow[]; issues: ProgramIssue[]; fatal?: string }

export type StoredProgramRow = {
  id: string
  storeCode: string
  machineNo: string | null
  serial: string | null
  vendor: string | null
  removedAt: string | null
  missingSince: string | null
}

/** The category name for a program in the note "Ticket sent to the <label> OEM for servicing." */
export const programNoteLabel = (name: string) => name.trim().replace(/\s+/g, ' ').slice(0, 80)

export const slugify = (name: string) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
