/**
 * Every field the old Zoho (ManageEngine) system holds on a ticket, turned into something a person can read.
 *
 * The copy keeps each ticket's whole original record, so nothing Zoho held is lost. This file decides, for each of
 * those fields, what to call it in plain English and whose field it is: the store's, the technician's, or Zoho's own
 * book-keeping. A field Zoho sends that is not listed here is still shown - under "Everything else Zoho held" - so a
 * new Zoho field can never go missing from the screen.
 *
 * No database and no server-only import, so the screens can use it too.
 */

export type ZohoFieldOwner = 'store' | 'technician' | 'system'

/** Zoho's field name -> what we call it, and whose field it is. */
const CATALOGUE: Record<string, { label: string; owner: ZohoFieldOwner }> = {
  // ── what the store (the person raising it) filled in ──────────────────────────────────────────────────────────────
  subject: { label: 'Subject', owner: 'store' },
  requester: { label: 'Raised by', owner: 'store' },
  created_by: { label: 'Entered by', owner: 'store' },
  created_time: { label: 'Raised on', owner: 'store' },
  on_behalf_of: { label: 'On behalf of', owner: 'store' },
  department: { label: 'Department', owner: 'store' },
  site: { label: 'Site', owner: 'store' },
  mode: { label: 'Raised through', owner: 'store' },
  template: { label: 'Service', owner: 'store' },
  request_type: { label: 'Request type', owner: 'store' },
  service_category: { label: 'Service category', owner: 'store' },
  category: { label: 'Category', owner: 'store' },
  subcategory: { label: 'Sub category', owner: 'store' },
  item: { label: 'Item', owner: 'store' },
  priority: { label: 'Priority', owner: 'store' },
  urgency: { label: 'Urgency', owner: 'store' },
  impact: { label: 'Impact', owner: 'store' },
  level: { label: 'Level', owner: 'store' },
  assets: { label: 'Assets', owner: 'store' },
  email_to: { label: 'E-mail to', owner: 'store' },
  email_cc: { label: 'E-mail cc', owner: 'store' },
  email_bcc: { label: 'E-mail bcc', owner: 'store' },
  email_ids_to_notify: { label: 'Also notify', owner: 'store' },

  // ── what the technician did ───────────────────────────────────────────────────────────────────────────────────────
  technician: { label: 'Technician', owner: 'technician' },
  group: { label: 'Group', owner: 'technician' },
  status: { label: 'Status', owner: 'technician' },
  assigned_time: { label: 'Assigned on', owner: 'technician' },
  responded_time: { label: 'Responded on', owner: 'technician' },
  first_responded_time: { label: 'First responded on', owner: 'technician' },
  resolved_time: { label: 'Resolved on', owner: 'technician' },
  completed_time: { label: 'Completed on', owner: 'technician' },
  time_elapsed: { label: 'Time taken', owner: 'technician' },
  resolution: { label: 'Resolution written by the technician', owner: 'technician' },
  closure_info: { label: 'Closure', owner: 'technician' },
  approval_status: { label: 'Approval', owner: 'technician' },
  is_fcr: { label: 'Settled on the first call', owner: 'technician' },
  is_reopened: { label: 'Reopened', owner: 'technician' },
  cancellation_requested: { label: 'Cancellation asked for', owner: 'technician' },
  cancel_flag_comments: { label: 'Cancellation remark', owner: 'technician' },
  completed_by_denial: { label: 'Finished by refusing it', owner: 'technician' },
  onhold_scheduler: { label: 'On hold until', owner: 'technician' },

  // ── Zoho's own book-keeping ───────────────────────────────────────────────────────────────────────────────────────
  id: { label: 'Zoho internal id', owner: 'system' },
  display_id: { label: 'Ticket number', owner: 'system' },
  display_key: { label: 'Ticket key', owner: 'system' },
  sla: { label: 'SLA', owner: 'system' },
  due_by_time: { label: 'Due by', owner: 'system' },
  first_response_due_by_time: { label: 'First response due by', owner: 'system' },
  is_overdue: { label: 'Overdue', owner: 'system' },
  is_first_response_overdue: { label: 'First response overdue', owner: 'system' },
  is_escalated: { label: 'Escalated', owner: 'system' },
  is_service_request: { label: 'Service request', owner: 'system' },
  is_trashed: { label: 'In the bin', owner: 'system' },
  is_read: { label: 'Read', owner: 'system' },
  has_notes: { label: 'Has notes', owner: 'system' },
  has_attachments: { label: 'Has attachments', owner: 'system' },
  has_draft: { label: 'Has a draft reply', owner: 'system' },
  has_linked_requests: { label: 'Has linked tickets', owner: 'system' },
  linked_to_request: { label: 'Linked to ticket', owner: 'system' },
  last_updated_time: { label: 'Last changed in Zoho', owner: 'system' },
  deleted_time: { label: 'Deleted on', owner: 'system' },
  unreplied_count: { label: 'Unanswered messages', owner: 'system' },
  tags: { label: 'Tags', owner: 'system' },
  lifecycle: { label: 'Life cycle', owner: 'system' },
  workflow: { label: 'Workflow', owner: 'system' },
  workflow_instance_details: { label: 'Workflow details', owner: 'system' },
  maintenance: { label: 'Maintenance', owner: 'system' },
  message_id: { label: 'Mail message id', owner: 'system' },
  notification_status: { label: 'Notification status', owner: 'system' },
  entity_instance_properties: { label: 'Extra properties', owner: 'system' },
  request_template_checklist_ids: { label: 'Checklists on the form', owner: 'system' },
  request_template_task_ids: { label: 'Tasks on the form', owner: 'system' },
  attachments: { label: 'Attachments', owner: 'system' },
}

/** Fields shown elsewhere on the screen in full, so they are not repeated in the field lists. */
export const SHOWN_SEPARATELY = new Set(['description', 'udf_fields', 'notes', 'resolution', 'closure_info', 'attachments'])

/** A Zoho field name we have never seen before, made readable: `first_response_due_by_time` -> `First response due by time`. */
export function tidyFieldName(key: string): string {
  const words = key.replace(/^udf_/, '').replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const ownerOf = (key: string): ZohoFieldOwner => CATALOGUE[key]?.owner ?? 'system'
export const labelOf = (key: string): string => CATALOGUE[key]?.label ?? tidyFieldName(key)
/** Has this Zoho field been given a proper name and an owner? If not it goes under "Everything else Zoho held". */
export const isKnownField = (key: string): boolean => key in CATALOGUE

/**
 * Where a field belongs in its group. Zoho sends its fields in no particular order, so without this the screen reads
 * like a jumble; this puts them in the order a person would ask about them, which is the order of the list above.
 */
const ORDER: Record<string, number> = Object.fromEntries(Object.keys(CATALOGUE).map((k, i) => [k, i]))
export const orderOf = (key: string): number => ORDER[key] ?? Number.MAX_SAFE_INTEGER

/** `12286000` milliseconds -> `3 h 24 m`. Zoho measures time taken in milliseconds. */
export function showElapsed(ms: unknown): string {
  const n = typeof ms === 'number' ? ms : Number(ms)
  if (!Number.isFinite(n) || n <= 0) return ''
  const mins = Math.round(n / 60000)
  if (mins < 60) return `${mins} m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return m ? `${h} h ${m} m` : `${h} h`
  const d = Math.floor(h / 24)
  return `${d} d ${h % 24} h`
}

/** Plain text out of the formatting an old Zoho e-mail or note carries. */
export function plainText(html: unknown): string {
  if (typeof html !== 'string') return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * One Zoho value as a person should read it. Zoho wraps almost everything: a date is
 * `{ value: "1794593357713", display_value: "Nov 13, 2026 11:39 PM" }`, a person or a list is `{ id, name }`,
 * and an unused field is `null` or an empty list. An empty string back means "there is nothing here".
 */
export function showZohoValue(key: string, v: unknown): string {
  if (v === null || v === undefined) return ''
  if (key === 'time_elapsed') return showElapsed(typeof v === 'object' && v !== null && 'value' in v ? (v as { value: unknown }).value : v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') {
    const t = /<[a-z!/]/i.test(v) ? plainText(v) : v.trim()
    return t
  }
  if (Array.isArray(v)) {
    const parts = v.map((x) => showZohoValue(key, x)).filter(Boolean)
    return parts.length === 0 ? '' : parts.join(', ')
  }
  const o = v as Record<string, unknown>
  // a date, or anything Zoho already wrote out for display
  if (typeof o.display_value === 'string' && o.display_value.trim()) return o.display_value.trim()
  // a person, a group, a status - anything with a name
  if (typeof o.name === 'string' && o.name.trim()) return o.name.trim()
  if (typeof o.email_id === 'string' && o.email_id.trim()) return o.email_id.trim()
  if (typeof o.content === 'string') return plainText(o.content)
  if (typeof o.value === 'string' || typeof o.value === 'number') return String(o.value).trim()
  if (typeof o.file_name === 'string') return o.file_name
  // something we have never met: show its readable parts rather than nothing
  const bits = Object.entries(o)
    .filter(([k]) => !['id', 'value'].includes(k))
    .map(([k, val]) => {
      const s = showZohoValue(k, val)
      return s ? `${tidyFieldName(k)}: ${s}` : ''
    })
    .filter(Boolean)
  return bits.join(' · ')
}

/** The technician's closure: the code they picked and what they wrote. This is where our technicians record what was done. */
export function showClosure(closure: unknown): { code: string; comments: string; by: string } {
  if (!closure || typeof closure !== 'object') return { code: '', comments: '', by: '' }
  const c = closure as Record<string, unknown>
  return {
    code: showZohoValue('closure_code', c.closure_code),
    comments: plainText(typeof c.closure_comments === 'string' ? c.closure_comments : ''),
    by: showZohoValue('requester', c.requester ?? c.closed_by ?? c.submitted_by),
  }
}
