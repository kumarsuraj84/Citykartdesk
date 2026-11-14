// The shapes and rules of the Zoho reports. No database and no server-only code, so the screens (which run in the browser) can use them too.
//
// Everything here speaks Zoho's own words - Zoho's statuses, Zoho's priorities, Zoho's service names, Zoho's technician and store names.
// Nothing is translated into CK Desk's words, because the two are not the same thing and nothing is linked between them.

/** The Zoho service whose tickets the AC reports are about. "AC PMS Form" is a different thing (the planned service) and is not counted here. */
export const AC_SERVICE = 'AC Issues Log System Only - Admin Team'

/** Zoho statuses that mean the ticket is still being worked on. These are Zoho's own words, exactly as ManageEngine wrote them. */
export const ZOHO_OPEN_STATUSES = [
  'Open',
  'In Process',
  'On Hold as Requester Intervention Required',
  'On Hold Due to Purchase from HO',
  'On Hold Due to Approval',
  'Support from OEM/Vendor',
] as const

/** Zoho statuses that mean the ticket is finished. "Reject" and "Rejected" are the same thing written two ways, so both are here. */
export const ZOHO_FINISHED_STATUSES = ['Closed', 'Resolved', 'Rejected', 'Reject', 'Workaround Provided'] as const

export const isZohoOpenStatus = (status: string | null | undefined) => ZOHO_OPEN_STATUSES.includes(String(status) as (typeof ZOHO_OPEN_STATUSES)[number])

/** The two spellings of Rejected shown as one word in a report. */
export const tidyZohoStatus = (status: string | null | undefined) => (status === 'Reject' ? 'Rejected' : (status ?? '(none)'))
/** A store is marked red when more than this share of its ACs have an open ticket (owner's rule). */
export const RED_FLAG_SHARE = 0.3

export type AgeBucket = '0-5' | '6-10' | '11-20' | '20+'
export const AGE_BUCKETS: { key: AgeBucket; label: string }[] = [
  { key: '0-5', label: '0–5 days' },
  { key: '6-10', label: '6–10 days' },
  { key: '11-20', label: '11–20 days' },
  { key: '20+', label: 'more than 20 days' },
]

/** How old a ticket is, in the buckets the owner's own report uses. The Excel stopped at 11-20 days; "more than 20 days" was added because otherwise
 *  almost half of the open AC tickets would not be shown anywhere at all. */
export function bucketOf(createdAt: string, asOn: Date): AgeBucket {
  const days = Math.floor((asOn.getTime() - new Date(createdAt).getTime()) / 86_400_000)
  if (days <= 5) return '0-5'
  if (days <= 10) return '6-10'
  if (days <= 20) return '11-20'
  return '20+'
}

export type StoreAcRow = {
  storeCode: string
  city: string | null
  cluster: string | null
  priorityList: string | null
  amcBrand: string | null
  acTotal: number | null
  zenatix: boolean | null
  inStoreMaster: boolean
  tickets: number
  buckets: Record<AgeBucket, number>
  /** open AC tickets divided by the store's AC total; null when the store or its AC total is unknown */
  share: number | null
  redFlag: boolean
}

export type StoreAcReport = {
  rows: StoreAcRow[]
  totals: { tickets: number; stores: number; redFlagStores: number; buckets: Record<AgeBucket, number> }
  /** store codes on the tickets that are not in Store Master (closed stores) */
  storesNotInMaster: string[]
  /** server-room ACs are left out of these reports unless asked for */
  serverRoomLeftOut: number
  asOn: string
}

// ── the Zoho dashboard ───────────────────────────────────────────────────────────────────────────────────────────────

export type Counted = { label: string; total: number; open: number }

export type ZohoDashboard = {
  /** when the copy of the Zoho data was last brought up to date, and whether that run went through */
  lastSync: { at: string | null; ok: boolean | null; note: string | null }
  totals: { tickets: number; open: number; finished: number; oldest: string | null; newest: string | null }
  /** how many of the finished tickets have no resolved date, so "how long did it take" cannot be worked out for them */
  finishedWithoutResolvedDate: number
  services: Counted[]
  statuses: Counted[]
  priorities: Counted[]
  /** one entry per month, newest last */
  months: { month: string; raised: number; finished: number }[]
  technicians: Counted[]
  stores: Counted[]
  openByAge: { bucket: AgeBucket; label: string; tickets: number }[]
}

// ── one Zoho ticket, looked up by its Zoho ticket number ─────────────────────────────────────────────────────────────

/** One line of a ticket's conversation: an e-mail, a note, or something the system recorded. */
export type ZohoTimelineEntry = {
  at: string | null
  kind: 'email' | 'note' | 'history' | 'conversation'
  /** "E-mail from ...", "Note", "Status changed" - in plain words */
  heading: string
  who: string | null
  subject: string | null
  body: string | null
  hasAttachments: boolean
}

export type ZohoTicketField = { label: string; value: string }

export type ZohoTicketDetail = {
  ticketNo: number
  /** the fields that every Zoho ticket has */
  main: ZohoTicketField[]
  /** the fields only this service uses (AC number, employee code, bank details, ...) - empty ones are left out */
  serviceFields: ZohoTicketField[]
  /** the original ManageEngine custom fields, kept so nothing from Zoho is ever lost */
  originalFields: ZohoTicketField[]
  timeline: ZohoTimelineEntry[]
  attachments: { fileName: string; size: number | null; saved: boolean }[]
  counts: { emails: number; notes: number; history: number; attachments: number }
  /** true when the conversation was cut short for the screen */
  timelineTrimmed: boolean
}
