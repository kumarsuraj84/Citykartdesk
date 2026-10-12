// One row per ticket with everything the Excel's "Data" sheet had, worked out in one place so every fixed
// report (and every filter) reads the same numbers:
//   - the ticket itself (status, dates, technician, service, category) and its age;
//   - what the requester typed (the AC number) and what the technician typed (OEM ticket number / date, AC resolution);
//   - the store's details from the Store Master (cluster, region, AC total, AMC brand ...) and its OEM;
//   - the calculated columns: ticket and OEM age buckets, open / close month and week, NSO, AC Not Working %, Red Flag.
// Pure functions, so each rule is easy to test. The database reading is in lib/queries/report-analytics.ts.

import { ageBucketLabel } from '@/lib/reporting/aging'
import { flattenAllLeafOptions } from '@/lib/forms/options'
import type { FormFieldOption } from '@/types'

import { UNASSIGNED, NO_CATEGORY, NO_SUB_CATEGORY } from './age-summary'
export { UNASSIGNED, NO_CATEGORY, NO_SUB_CATEGORY }
export const NO_OEM = '(No OEM)'
export const NO_STORE = '(No store)'
export const SERVER_ROOM_AC = 'server room ac'

/** A store is "NSO" (new store opening) while it has no open date, or until this many months after it opened. */
export const NSO_MONTHS = 9
/** AC Not Working % above this is a red flag (the viewer can change it on the Store AC report). */
export const DEFAULT_RED_FLAG_PERCENT = 30

export interface TicketFact {
  id: string
  ticketNo: string
  subject: string
  requester: string
  technician: string
  category: string
  subCategory: string
  service: string
  serviceId: string
  /** the service goes to an OEM (AC servicing) */
  isAcTicket: boolean
  status: string
  priority: string
  /** ISO timestamps */
  createdAt: string
  resolvedAt: string | null
  ageDays: number
  ageBucket: string

  // the requester's store (Store Master); '' when the requester is not a store or the value is not set
  store: string
  isStoreAccount: boolean
  city: string
  state: string
  cluster: string
  region: string
  priorityList: string
  festival: string
  acBrand: string
  acAmcBrand: string
  acAmcVendor: string
  acTotal: number | null
  zenatix: '' | 'Yes' | 'No'
  /** yyyy-mm-dd */
  openDate: string | null
  /** 'NSO' | 'Regular' for a store; '' when the requester is not a store */
  storeType: '' | 'NSO' | 'Regular'
  /** the store's OEM; '' unless the ticket's service goes to an OEM */
  oem: string

  // typed on the ticket (AC service)
  acNo: string
  oemTicketNo: string
  /** yyyy-mm-dd */
  oemTicketDate: string | null
  acResolution: string
  oemAgeDays: number | null
  oemBucket: string

  // calendar
  openMonth: string
  openWeek: string
  closeMonth: string
  closeWeek: string

  // the store's AC position
  /** open AC tickets of this store (Server Room AC excluded) */
  storeAcTickets: number
  /** storeAcTickets / acTotal, as a percentage (0-100); null when the AC total is not known */
  acNotWorkingPct: number | null
  redFlag: '' | 'Yes' | 'No'
}

// ── Calendar ──────────────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Oct-26": the month a date falls in. Local calendar day, like the other reports. */
export function monthLabel(d: Date): string {
  return `${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`
}

/** Week of the month, Monday to Sunday: the 1st of the month starts Week-1 even when it is a Thursday, the next Monday starts Week-2. */
export function weekOfMonth(d: Date): string {
  const firstWeekday = (new Date(d.getFullYear(), d.getMonth(), 1).getDay() + 6) % 7 // Monday = 0
  return `Week-${Math.floor((d.getDate() - 1 + firstWeekday) / 7) + 1}`
}

/** Sort key of a "Oct-26" label so months list in calendar order. */
export function monthSortKey(label: string): number {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(label)
  return m ? (2000 + Number(m[2])) * 12 + MONTHS.indexOf(m[1]) : 0
}

function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
const toDay = (isoDay: string) => { const [y, m, d] = isoDay.split('-').map(Number); return new Date(y, m - 1, d) }

/** Whole days from one calendar day to another (later - earlier). */
export function daysFrom(isoDay: string, asOf: Date): number {
  return Math.round((startOfDay(asOf).getTime() - toDay(isoDay).getTime()) / 86_400_000)
}

/**
 * A ticket's age in WHOLE DAYS that have passed since it was created, as the Excel counts it (created 1 Oct in the morning, looked at on
 * 12 Oct in the afternoon: 11 days; created today: 0). A day counts only once 24 hours have gone by, so a ticket created yesterday at 6 pm is
 * still 0 days old at 10 am today. (The Excel's ages are never above the calendar difference and sometimes one below it, which is exactly this.)
 */
export function ageInDays(createdIso: string, endIso: string): number {
  return Math.max(0, Math.floor((new Date(endIso).getTime() - new Date(createdIso).getTime()) / 86_400_000))
}

/**
 * NSO: a store with no open date, or one that opened less than `months` months ago (opened 14 Feb 2026 -> NSO through
 * 14 Nov 2026, regular from 15 Nov).
 */
export function isNsoStore(openDate: string | null, asOf: Date, months: number = NSO_MONTHS): boolean {
  if (!openDate) return true
  const o = toDay(openDate)
  const until = new Date(o.getFullYear(), o.getMonth() + months, o.getDate())
  return startOfDay(asOf).getTime() <= until.getTime()
}

// ── Typed-in details ─────────────────────────────────────────────────────────────────────────────

/** The AC form fields of a service, found by their label, so a template change does not break the reports. */
export interface AcFormFields {
  acNo?: { id: string; options?: FormFieldOption[] }
  oemTicketNo?: { id: string }
  oemTicketDate?: { id: string }
  acResolution?: { id: string; options?: FormFieldOption[] }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Picks the AC fields out of a service's form fields (all the fields of one service). */
export function acFormFields(fields: { id: string; label: string; options?: FormFieldOption[] }[]): AcFormFields {
  const out: AcFormFields = {}
  for (const f of fields) {
    switch (norm(f.label)) {
      case 'ac serial number': out.acNo = { id: f.id, options: f.options }; break
      case 'ac oem ticket number': out.oemTicketNo = { id: f.id }; break
      case 'ac oem ticket creation date': out.oemTicketDate = { id: f.id }; break
      case 'ac resolution': out.acResolution = { id: f.id, options: f.options }; break
    }
  }
  return out
}

/** A saved answer as text: a select's saved value is its option id, shown by the option's name. */
export function answerText(raw: unknown, options?: FormFieldOption[]): string {
  if (raw == null) return ''
  const v = Array.isArray(raw) ? raw.join(', ') : String(raw)
  if (v === '') return ''
  const hit = flattenAllLeafOptions(options).find((o) => o.value === v)
  return (hit?.label ?? v).trim()
}

/** yyyy-mm-dd from a saved date answer (a plain date or an ISO timestamp), or null. */
export function answerDay(raw: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? '').trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** The AC number a ticket says is not working; "Server Room AC" is not one of the store's counted ACs. */
export function isServerRoomAc(acNo: string): boolean { return norm(acNo) === SERVER_ROOM_AC }

// ── Making a fact ────────────────────────────────────────────────────────────────────────────────

export interface RawTicket {
  id: string
  request_no: string
  title: string
  status: string
  priority: string
  created_at: string
  resolved_at: string | null
  closed_at: string | null
  form_data: Record<string, unknown> | null
  service: { id: string; name: string; auto_oem_routing: boolean | null } | null
  category: { name: string } | null
  sub_category: { name: string } | null
  assignee: { full_name: string } | null
  requester: {
    full_name: string
    store: {
      id: string; code: string; city: string | null; state: string | null; cluster: string | null; region: string | null
      priority_list: string | null; festival: string | null; ac_total: number | null; ac_brand: string | null
      ac_amc_brand: string | null; ac_amc_vendor: string | null; zenatix: boolean | null; open_date: string | null
      oem: { name: string } | null
    } | null
  } | null
}

export interface FactContext {
  /** the day the report is "as on" (today) */
  asOf: Date
  /** per service id: where its AC form fields are */
  acFields: ReadonlyMap<string, AcFormFields>
  /** open AC tickets per store code (Server Room AC excluded) */
  openAcByStore: ReadonlyMap<string, number>
  redFlagPercent: number
  nsoMonths?: number
}

export function makeFact(r: RawTicket, ctx: FactContext): TicketFact {
  const nowIso = ctx.asOf.toISOString()
  // still open: age so far; resolved / closed: how long it took
  const ageDays = ageInDays(r.created_at, r.resolved_at ?? r.closed_at ?? nowIso)
  const store = r.requester?.store ?? null
  const isAc = !!r.service?.auto_oem_routing
  const f = r.service ? ctx.acFields.get(r.service.id) : undefined
  const data = r.form_data ?? {}

  const acNo = f?.acNo ? answerText(data[f.acNo.id], f.acNo.options) : ''
  const oemTicketDate = f?.oemTicketDate ? answerDay(data[f.oemTicketDate.id]) : null
  const oemAgeDays = oemTicketDate ? Math.max(0, daysFrom(oemTicketDate, ctx.asOf)) : null

  const storeCode = store?.code ?? ''
  const acTotal = store?.ac_total ?? null
  const storeAcTickets = storeCode ? (ctx.openAcByStore.get(storeCode) ?? 0) : 0
  const pct = acTotal && acTotal > 0 && storeCode ? (storeAcTickets / acTotal) * 100 : null

  const created = new Date(r.created_at)
  const resolved = r.resolved_at ? new Date(r.resolved_at) : null

  return {
    id: r.id,
    ticketNo: r.request_no,
    subject: r.title,
    requester: r.requester?.full_name ?? '',
    technician: r.assignee?.full_name ?? UNASSIGNED,
    category: r.category?.name ?? NO_CATEGORY,
    subCategory: r.sub_category?.name ?? NO_SUB_CATEGORY,
    service: r.service?.name ?? '',
    serviceId: r.service?.id ?? '',
    isAcTicket: isAc,
    status: r.status,
    priority: r.priority,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    ageDays,
    ageBucket: ageBucketLabel(ageDays),

    // a store's account is named after the store; anyone else (head office staff) shows under their own name
    store: storeCode || r.requester?.full_name || NO_STORE,
    isStoreAccount: !!store,
    city: store?.city?.trim() ?? '',
    state: store?.state?.trim() ?? '',
    cluster: store?.cluster?.trim() ?? '',
    region: store?.region?.trim() ?? '',
    priorityList: store?.priority_list?.trim() ?? '',
    festival: store?.festival?.trim() ?? '',
    acBrand: store?.ac_brand?.trim() ?? '',
    acAmcBrand: store?.ac_amc_brand?.trim() ?? '',
    acAmcVendor: store?.ac_amc_vendor?.trim() ?? '',
    acTotal,
    zenatix: store?.zenatix == null ? '' : store.zenatix ? 'Yes' : 'No',
    openDate: store?.open_date ?? null,
    storeType: store ? (isNsoStore(store.open_date, ctx.asOf, ctx.nsoMonths) ? 'NSO' : 'Regular') : '',
    // an OEM only has to do with tickets of services that go to an OEM; an IT or HR ticket from the same store has none
    oem: isAc ? (store?.oem?.name ?? NO_OEM) : '',

    acNo,
    oemTicketNo: f?.oemTicketNo ? answerText(data[f.oemTicketNo.id]) : '',
    oemTicketDate,
    acResolution: f?.acResolution ? answerText(data[f.acResolution.id], f.acResolution.options) : '',
    oemAgeDays,
    // no OEM ticket date typed yet: no age (the Excel showed these as "0-5")
    oemBucket: oemAgeDays == null ? '' : ageBucketLabel(oemAgeDays),

    openMonth: monthLabel(created),
    openWeek: weekOfMonth(created),
    closeMonth: resolved ? monthLabel(resolved) : '',
    closeWeek: resolved ? weekOfMonth(resolved) : '',

    storeAcTickets,
    acNotWorkingPct: pct,
    redFlag: pct == null ? '' : pct > ctx.redFlagPercent ? 'Yes' : 'No',
  }
}
