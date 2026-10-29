import { STARTER_TEMPLATE_HTML } from '@/lib/email/oem-template'
import { programNoteLabel, type ProgramRecord } from './types'

// The mail a program sends to its vendor / OEM when a ticket is raised. Pure (no database). The wording is edited on the program's screen with the same editor and the same
// cleaning as the AC / Genset templates; rendering uses renderMasterMail (lib/masters/mail.ts), so the table, the link-safe text and the escaping are the same everywhere.
// Safe to load in the browser (the admin screen lists the fields from here).

export type ProgramRowRecord = {
  id: string
  store_code: string
  machine_no: string | null
  serial: string | null
  vendor: string | null
  emails: string[]
  po_emails: string[]
  approver_emails: string[]
  extra: Record<string, string> | null
  is_active: boolean
  sheet_row: number | null
}

export const PROGRAM_COMMON_FIELDS = ['ticket_no', 'subject', 'description', 'requester_name', 'requester_email', 'requester_phone', 'store_address', 'store_code', 'category', 'program', 'vendor', 'machine_no', 'serial', 'details'] as const

/** The field name of an extra sheet column: "Brand Name" -> extra_brandname. */
export const extraKey = (heading: string) => `extra_${heading.toLowerCase().replace(/[^a-z0-9]/g, '')}`

export const DEFAULT_PROGRAM_SUBJECT = 'New {{program}} Ticket - {{ticket_no}} - {{store_code}}'
export const DEFAULT_PROGRAM_BODY = STARTER_TEMPLATE_HTML.replace(
  '<tr><th>Issue</th>',
  '<tr><th>Store Code</th><td>{{store_code}}</td></tr><tr><th>Vendor</th><td>{{vendor}}</td></tr><tr><th>Machine Details</th><td>{{details}}</td></tr><tr><th>Issue</th>',
)

export const PROGRAM_SAMPLE_VALUES: Record<string, string> = {
  ticket_no: 'CKSD-000123', subject: 'Water not cooling', description: 'The purifier at the entrance is not working since morning.\nPlease send a technician.',
  requester_name: 'Store Manager', requester_email: 'store.manager@citykartstores.com', requester_phone: '98XXXXXX10', store_address: 'Main Road, Civil Lines, Allahabad - 211001',
  store_code: 'ALC', category: 'Water purifier', program: 'RO Water Purifier', vendor: 'Aqua Care', machine_no: '1', serial: 'RO-12345', details: 'Machine 1, serial RO-12345, Aqua Care',
}

const unique = (list: (string | null | undefined)[]) => [...new Set(list.map((v) => (v ?? '').trim()).filter(Boolean))]

/** The values a program adds to the mail for the store's rows (one mail covers every active row of the store). */
export function programVars(program: Pick<ProgramRecord, 'name' | 'row_type'>, rows: ProgramRowRecord[]): Record<string, string> {
  const details = rows.map((r) => {
    const bits = program.row_type === 'machine'
      ? [r.machine_no ? `Machine ${r.machine_no}` : '', r.serial ? `serial ${r.serial}` : '', r.vendor ?? '']
      : [r.vendor ?? '', r.serial ? `serial ${r.serial}` : '']
    return bits.filter(Boolean).join(', ')
  }).filter(Boolean)
  const vars: Record<string, string> = {
    program: programNoteLabel(program.name), vendor: unique(rows.map((r) => r.vendor)).join(' / '), machine_no: unique(rows.map((r) => r.machine_no)).join(' / '),
    serial: unique(rows.map((r) => r.serial)).join(' / '), details: details.join('\n'),
  }
  const extras = new Map<string, string[]>()
  for (const r of rows) for (const [h, v] of Object.entries(r.extra ?? {})) extras.set(extraKey(h), [...(extras.get(extraKey(h)) ?? []), v])
  for (const [k, list] of extras) vars[k] = unique(list).join(' / ')
  return vars
}

/** Every `{{field}}` the program's mail may use: the common ones and the program's extra sheet columns. */
export function allowedFields(extraHeadings: string[]): string[] {
  return [...PROGRAM_COMMON_FIELDS, ...extraHeadings.map(extraKey)]
}

/** The `{{fields}}` of a template that no value exists for (typed wrongly): they would go out empty. */
export function unknownFields(template: string, allowed: string[]): string[] {
  const ok = new Set(allowed)
  return [...new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].filter((f) => !ok.has(f))
}

export function programTemplate(p: Pick<ProgramRecord, 'mail_subject' | 'mail_body_html'>): { subject: string; body: string } {
  return { subject: p.mail_subject?.trim() || DEFAULT_PROGRAM_SUBJECT, body: p.mail_body_html?.trim() || DEFAULT_PROGRAM_BODY }
}
