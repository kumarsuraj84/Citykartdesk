import 'server-only'
import { zohoQuery } from './db'
import { prepareMailHtml } from '@/lib/intake/mail-html'
import {
  AC_SERVICE, AGE_BUCKETS, RED_FLAG_SHARE, ZOHO_FINISHED_STATUSES, ZOHO_OPEN_STATUSES, tidyZohoStatus,
  type AgeBucket, type Counted, type StoreAcReport, type StoreAcRow, type ZohoDashboard, type ZohoTicketDetail, type ZohoTicketField, type ZohoTimelineEntry,
} from './report-shapes'

/**
 * Every read the Zoho Data tab makes. All of it goes to the ZOHO holding database through the read-only login - no CK Desk table is touched here,
 * and no Zoho row is written anywhere. Values a person typed always travel as parameters ($1, $2, ...), never inside the query text.
 */

const OPEN = [...ZOHO_OPEN_STATUSES]
const FINISHED = [...ZOHO_FINISHED_STATUSES]

/** The age-bucket rule of lib/zoho/report-shapes.ts, written for the database so a whole report can be counted in one pass. */
const AGE_CASE = (col: string) => `case
  when floor(extract(epoch from (now() - ${col})) / 86400) <= 5 then '0-5'
  when floor(extract(epoch from (now() - ${col})) / 86400) <= 10 then '6-10'
  when floor(extract(epoch from (now() - ${col})) / 86400) <= 20 then '11-20'
  else '20+' end`

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
/**
 * A database timestamp as plain ISO text for the screen. The driver hands back a real date for a timestamptz column, so there is nothing to parse;
 * Postgres' own `OF` format is deliberately NOT used, because it writes a whole-hour offset as "+00", which a browser refuses to read as a date.
 */
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null)
const emptyBuckets =(): Record<AgeBucket, number> => ({ '0-5': 0, '6-10': 0, '11-20': 0, '20+': 0 })

// ── the Zoho dashboard ───────────────────────────────────────────────────────────────────────────────────────────────

type CountRow = { label: string | null; total: string; open: string }
const toCounted = (rows: CountRow[]): Counted[] => rows.map((r) => ({ label: r.label ?? '(none)', total: n(r.total), open: n(r.open) }))

export async function getZohoDashboard(): Promise<ZohoDashboard> {
  const [totals, sync, services, statuses, priorities, raised, finishedByMonth, technicians, stores, ages] = await Promise.all([
    zohoQuery<{ total: string; open: string; finished: string; oldest: string | null; newest: string | null; no_resolved: string }>(
      `select count(*)::text as total,
              count(*) filter (where status = any($1))::text as open,
              count(*) filter (where status = any($2))::text as finished,
              to_char(min(created_at), 'YYYY-MM-DD') as oldest,
              to_char(max(created_at), 'YYYY-MM-DD') as newest,
              count(*) filter (where status = any($2) and resolved_at is null)::text as no_resolved
         from zoho_ticket`,
      [OPEN, FINISHED],
    ),
    zohoQuery<{ at: Date | null; ok: boolean | null; error: string | null; mode: string | null }>(
      `select coalesce(finished_at, started_at) as at, ok, error, mode
         from zoho_sync_run order by id desc limit 1`,
    ),
    zohoQuery<CountRow>(
      `select coalesce(template, '(none)') as label, count(*)::text as total, count(*) filter (where status = any($1))::text as open
         from zoho_ticket group by 1 order by count(*) desc`,
      [OPEN],
    ),
    zohoQuery<CountRow>(
      `select status as label, count(*)::text as total, count(*) filter (where status = any($1))::text as open
         from zoho_ticket group by status order by count(*) desc`,
      [OPEN],
    ),
    zohoQuery<CountRow>(
      `select coalesce(priority, '(none)') as label, count(*)::text as total, count(*) filter (where status = any($1))::text as open
         from zoho_ticket group by 1 order by count(*) desc`,
      [OPEN],
    ),
    zohoQuery<{ month: string; c: string }>(
      `select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, count(*)::text as c
         from zoho_ticket where created_at >= date_trunc('month', now()) - interval '12 months' group by 1`,
    ),
    zohoQuery<{ month: string; c: string }>(
      `select to_char(date_trunc('month', resolved_at), 'YYYY-MM') as month, count(*)::text as c
         from zoho_ticket where resolved_at >= date_trunc('month', now()) - interval '12 months' group by 1`,
    ),
    zohoQuery<CountRow>(
      `select coalesce(nullif(btrim(technician_name), ''), '(nobody)') as label, count(*)::text as total, count(*) filter (where status = any($1))::text as open
         from zoho_ticket group by 1 order by count(*) desc limit 20`,
      [OPEN],
    ),
    zohoQuery<CountRow>(
      `select coalesce(nullif(btrim(requester_name), ''), '(none)') as label, count(*)::text as total, count(*) filter (where status = any($1))::text as open
         from zoho_ticket group by 1 order by count(*) desc limit 20`,
      [OPEN],
    ),
    zohoQuery<{ bucket: AgeBucket; c: string }>(
      `select ${AGE_CASE('created_at')} as bucket, count(*)::text as c
         from zoho_ticket where status = any($1) group by 1`,
      [OPEN],
    ),
  ])

  const t = totals[0]
  const raisedBy = new Map(raised.map((r) => [r.month, n(r.c)]))
  const finishedBy = new Map(finishedByMonth.map((r) => [r.month, n(r.c)]))
  const months: ZohoDashboard['months'] = []
  const start = new Date()
  start.setUTCDate(1)
  for (let i = 12; i >= 0; i--) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - i, 1))
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    months.push({ month: key, raised: raisedBy.get(key) ?? 0, finished: finishedBy.get(key) ?? 0 })
  }

  const ageBy = new Map(ages.map((a) => [a.bucket, n(a.c)]))
  const s = sync[0]

  // the two spellings of Rejected are shown as one line
  const statusMap = new Map<string, Counted>()
  for (const row of toCounted(statuses)) {
    const label = tidyZohoStatus(row.label)
    const prev = statusMap.get(label)
    statusMap.set(label, prev ? { label, total: prev.total + row.total, open: prev.open + row.open } : { ...row, label })
  }

  return {
    lastSync: {
      at: iso(s?.at),
      ok: s?.ok ?? null,
      note: s?.ok === false ? 'The last run of the copy did not finish cleanly, so the newest tickets may be missing.' : s?.mode ? `last run: ${s.mode}` : null,
    },
    totals: { tickets: n(t?.total), open: n(t?.open), finished: n(t?.finished), oldest: t?.oldest ?? null, newest: t?.newest ?? null },
    finishedWithoutResolvedDate: n(t?.no_resolved),
    services: toCounted(services),
    statuses: [...statusMap.values()].sort((a, b) => b.total - a.total),
    priorities: toCounted(priorities),
    months,
    technicians: toCounted(technicians),
    stores: toCounted(stores),
    openByAge: AGE_BUCKETS.map((b) => ({ bucket: b.key, label: b.label, tickets: ageBy.get(b.key) ?? 0 })),
  }
}

// ── the store AC report (the first of the owner's own reports) ────────────────────────────────────────────────────────

export async function getStoreAcReport(): Promise<StoreAcReport> {
  const rows = await zohoQuery<{
    code: string; city: string | null; cluster: string | null; priority_list: string | null; amc_brand: string | null
    ac_total: number | null; zenatix: boolean | null; in_master: boolean; tickets: string
    b1: string; b2: string; b3: string; b4: string
  }>(
    `with t as (
       select upper(btrim(coalesce(requester_name, ''))) as code, created_at
         from zoho_ticket
        where template = $1 and status = any($2)
     )
     select t.code,
            m.city, m.cluster, m.priority_list, m.amc_brand, m.ac_total, m.zenatix,
            (m.store_code is not null) as in_master,
            count(*)::text as tickets,
            count(*) filter (where ${AGE_CASE('t.created_at')} = '0-5')::text   as b1,
            count(*) filter (where ${AGE_CASE('t.created_at')} = '6-10')::text  as b2,
            count(*) filter (where ${AGE_CASE('t.created_at')} = '11-20')::text as b3,
            count(*) filter (where ${AGE_CASE('t.created_at')} = '20+')::text   as b4
       from t left join zoho_store_master m on m.store_code = t.code
      group by t.code, m.store_code, m.city, m.cluster, m.priority_list, m.amc_brand, m.ac_total, m.zenatix
      order by count(*) desc`,
    [AC_SERVICE, OPEN],
  )

  const out: StoreAcRow[] = rows.map((r) => {
    const tickets = n(r.tickets)
    const acTotal = r.ac_total === null ? null : n(r.ac_total)
    const share = acTotal && acTotal > 0 ? tickets / acTotal : null
    return {
      storeCode: r.code || '(none)',
      city: r.city, cluster: r.cluster, priorityList: r.priority_list, amcBrand: r.amc_brand,
      acTotal, zenatix: r.zenatix, inStoreMaster: r.in_master,
      tickets,
      buckets: { '0-5': n(r.b1), '6-10': n(r.b2), '11-20': n(r.b3), '20+': n(r.b4) },
      share,
      redFlag: share !== null && share >= RED_FLAG_SHARE,
    }
  })
  // worst first: the stores with the biggest share of their ACs down, then the stores we have no AC total for
  out.sort((a, b) => (b.share ?? -1) - (a.share ?? -1) || b.tickets - a.tickets)

  const totals = { tickets: 0, stores: out.length, redFlagStores: 0, buckets: emptyBuckets() }
  for (const r of out) {
    totals.tickets += r.tickets
    if (r.redFlag) totals.redFlagStores++
    for (const b of AGE_BUCKETS) totals.buckets[b.key] += r.buckets[b.key]
  }

  return {
    rows: out,
    totals,
    storesNotInMaster: out.filter((r) => !r.inStoreMaster).map((r) => r.storeCode),
    // the Zoho data does not say which AC is in a server room, so none are left out here
    serverRoomLeftOut: 0,
    asOn: new Date().toISOString(),
  }
}

// ── one ticket, by its Zoho ticket number ────────────────────────────────────────────────────────────────────────────

/** Only the fields every Zoho ticket has. */
const MAIN_FIELDS: { col: string; label: string }[] = [
  { col: 'template', label: 'Service' },
  { col: 'status', label: 'Status' },
  { col: 'priority', label: 'Priority' },
  { col: 'request_type', label: 'Request type' },
  { col: 'mode', label: 'Raised through' },
  { col: 'requester_name', label: 'Raised by' },
  { col: 'requester_email', label: 'Raised by (e-mail)' },
  { col: 'technician_name', label: 'Technician' },
  { col: 'technician_email', label: 'Technician (e-mail)' },
  { col: 'group_name', label: 'Group' },
  { col: 'category', label: 'Category' },
  { col: 'subcategory', label: 'Sub category' },
  { col: 'item', label: 'Item' },
  { col: 'created_at', label: 'Raised on' },
  { col: 'resolved_at', label: 'Finished on' },
  { col: 'etr', label: 'Expected by (ETR)' },
  { col: 'contact_detail', label: 'Contact detail' },
]

/** The fields only some services use. An empty one is simply not shown. */
const SERVICE_FIELDS: { col: string; label: string }[] = [
  { col: 'ac_number', label: 'AC number' }, { col: 'ac_style', label: 'AC style' }, { col: 'ac_serial_no', label: 'AC serial no' },
  { col: 'ac_serial_raw', label: 'AC serial (as typed)' }, { col: 'ac_model', label: 'AC model' }, { col: 'ac_code', label: 'AC code' },
  { col: 'ac_floor', label: 'AC floor' }, { col: 'ac_area', label: 'AC area' }, { col: 'ac_tonnage', label: 'AC tonnage' },
  { col: 'ac_resolution', label: 'AC resolution' }, { col: 'ac_oem_ticket_no', label: 'OEM ticket no' },
  { col: 'ac_oem_ticket_created_at', label: 'OEM ticket raised on' }, { col: 'ac_oem_ticket_completed_at', label: 'OEM ticket completed on' },
  { col: 'store_address', label: 'Store address' }, { col: 'pms_date', label: 'PMS date' },
  { col: 'emp_code', label: 'Employee code' }, { col: 'serial_number', label: 'Serial number' }, { col: 'serial_number_item', label: 'Serial number (item)' },
  { col: 'non_trading_item', label: 'Non-trading item' }, { col: 'required_item_it', label: 'Required item (IT)' },
  { col: 'sto_to_no', label: 'STO / TO number' }, { col: 'faulty_item_qty', label: 'Faulty item qty' }, { col: 'repaired_item_qty', label: 'Repaired item qty' },
  { col: 'qty', label: 'Quantity' }, { col: 'festival', label: 'Festival' },
  { col: 'division_apps', label: 'Division (Apps)' }, { col: 'division_gm', label: 'Division (GM)' },
  { col: 'products_services_detail', label: 'Products / services detail' },
  { col: 'contact_person_name', label: 'Contact person' }, { col: 'contact_person_ph_no', label: 'Contact person phone' },
  { col: 'invoice_no', label: 'Invoice no' }, { col: 'refundable_amount', label: 'Refundable amount' }, { col: 'transaction_date', label: 'Transaction date' },
  { col: 'a_c_holder_name', label: 'Account holder' }, { col: 'bank_name', label: 'Bank' }, { col: 'bank_a_c_no', label: 'Bank account no' }, { col: 'bank_ifsc_code', label: 'IFSC' },
  { col: 'vendor_name', label: 'Vendor name' }, { col: 'vendor_address', label: 'Vendor address' }, { col: 'vendor_city', label: 'Vendor city' },
  { col: 'vendor_state', label: 'Vendor state' }, { col: 'vendor_pincode', label: 'Vendor pincode' }, { col: 'vendor_email_id', label: 'Vendor e-mail' },
  { col: 'vendor_pan_no', label: 'Vendor PAN' }, { col: 'vendor_gst_no', label: 'Vendor GST' }, { col: 'vendor_msme_certificate_no', label: 'Vendor MSME certificate' },
  { col: 'company_type', label: 'Company type' }, { col: 'industry_type', label: 'Industry type' }, { col: 'vendor_creation_in', label: 'Vendor creation in' },
  { col: 'vendor_ticket_no', label: 'Vendor ticket no' }, { col: 'vendor_ticket_creation_date', label: 'Vendor ticket raised on' },
]

const SELECT_COLS = ['zoho_id', 'display_id', 'subject', 'udf', ...MAIN_FIELDS.map((f) => f.col), ...SERVICE_FIELDS.map((f) => f.col)]

const TIMELINE_LIMIT = 300

function show(v: unknown): string {
  if (v === null || v === undefined) return ''
  // a date is shown the way the rest of the application shows one, not as the raw database text
  if (v instanceof Date) return v.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v).trim()
}

/** The Zoho ticket number as typed by a person, or null when it is not a ticket number at all. */
export function parseZohoTicketNo(input: string): number | null {
  const t = String(input ?? '').trim().replace(/^#/, '').replace(/[\s,]/g, '')
  if (!/^\d{1,18}$/.test(t)) return null
  const no = Number(t)
  return Number.isSafeInteger(no) && no > 0 ? no : null
}

export async function getZohoTicket(ticketNo: number): Promise<ZohoTicketDetail | null> {
  const head = await zohoQuery<Record<string, unknown>>(
    `select ${SELECT_COLS.join(', ')} from zoho_ticket where display_id = $1 limit 1`,
    [ticketNo],
  )
  const row = head[0]
  if (!row) return null
  const zohoId = String(row.zoho_id)

  const [emails, notes, history, attachments, counts] = await Promise.all([
    zohoQuery<{ at: Date | null; kind: string | null; subject: string | null; sender: string | null; body: string | null; has_attachments: boolean | null }>(
      `select sent_at as at, kind, subject, sender, body, has_attachments
         from zoho_email where ticket_zoho_id = $1 order by sent_at nulls last limit $2`,
      [zohoId, TIMELINE_LIMIT],
    ),
    zohoQuery<{ at: Date | null; who: string | null; body: string | null }>(
      `select created_at as at, raw -> 'created_by' ->> 'name' as who, raw ->> 'description' as body
         from zoho_note where ticket_zoho_id = $1 order by created_at nulls last limit $2`,
      [zohoId, TIMELINE_LIMIT],
    ),
    zohoQuery<{ at: Date | null; operation: string | null; who: string | null; body: string | null }>(
      `select happened_at as at, operation, raw -> 'by' ->> 'name' as who, raw ->> 'description' as body
         from zoho_history where ticket_zoho_id = $1 order by happened_at nulls last limit $2`,
      [zohoId, TIMELINE_LIMIT],
    ),
    zohoQuery<{ file_name: string | null; size: string | null; status: string | null }>(
      `select file_name, coalesce(stored_size, declared_size)::text as size, status
         from zoho_attachment where ticket_zoho_id = $1 order by file_name`,
      [zohoId],
    ),
    zohoQuery<{ emails: string; notes: string; history: string; attachments: string }>(
      `select (select count(*) from zoho_email where ticket_zoho_id = $1)::text as emails,
              (select count(*) from zoho_note where ticket_zoho_id = $1)::text as notes,
              (select count(*) from zoho_history where ticket_zoho_id = $1)::text as history,
              (select count(*) from zoho_attachment where ticket_zoho_id = $1)::text as attachments`,
      [zohoId],
    ),
  ])

  const timeline: ZohoTimelineEntry[] = [
    ...emails.map((e): ZohoTimelineEntry => ({
      at: iso(e.at), kind: 'email',
      heading: e.kind === 'REQREPLY' ? 'Reply from the person who raised it' : 'E-mail sent by the system',
      who: e.sender, subject: e.subject,
      body: prepareMailHtml(e.body),
      hasAttachments: !!e.has_attachments,
    })),
    ...notes.map((x): ZohoTimelineEntry => ({ at: iso(x.at), kind: 'note', heading: 'Note', who: x.who, subject: null, body: prepareMailHtml(x.body), hasAttachments: false })),
    ...history.map((h): ZohoTimelineEntry => ({
      at: iso(h.at), kind: 'history',
      heading: h.operation === 'add' ? 'Ticket raised' : h.operation === 'update' ? 'Changed' : `Recorded (${h.operation ?? 'unknown'})`,
      who: h.who, subject: null,
      body: h.body && h.body !== 'null' ? h.body : null,
      hasAttachments: false,
    })),
  ].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))

  const field = (f: { col: string; label: string }): ZohoTicketField | null => {
    const v = show(row[f.col])
    return v === '' ? null : { label: f.label, value: v }
  }
  const udf = (row.udf ?? {}) as Record<string, unknown>

  return {
    ticketNo: Number(row.display_id),
    main: [
      { label: 'Zoho ticket no', value: String(row.display_id) },
      { label: 'Subject', value: show(row.subject) || '(no subject)' },
      ...MAIN_FIELDS.map(field).filter((x): x is ZohoTicketField => x !== null),
    ],
    serviceFields: SERVICE_FIELDS.map(field).filter((x): x is ZohoTicketField => x !== null),
    originalFields: Object.entries(udf)
      .map(([k, v]) => ({ label: k, value: show(v) }))
      .filter((x) => x.value !== '' && x.value !== 'null')
      .sort((a, b) => a.label.localeCompare(b.label)),
    timeline: timeline.slice(0, TIMELINE_LIMIT),
    attachments: attachments.map((a) => ({ fileName: a.file_name ?? '(no name)', size: a.size === null ? null : n(a.size), saved: a.status === 'ok' })),
    counts: { emails: n(counts[0]?.emails), notes: n(counts[0]?.notes), history: n(counts[0]?.history), attachments: n(counts[0]?.attachments) },
    timelineTrimmed: timeline.length > TIMELINE_LIMIT,
  }
}

/** A short list of tickets matching free text, so a person who does not have the number can still find one. */
export async function searchZohoTickets(text: string, limit = 25): Promise<{ ticketNo: number; subject: string | null; status: string; requester: string | null; createdAt: string | null }[]> {
  const q = String(text ?? '').trim()
  if (q.length < 3) return []
  const rows = await zohoQuery<{ display_id: string; subject: string | null; status: string; requester_name: string | null; at: string | null }>(
    `select display_id::text, subject, status, requester_name, to_char(created_at, 'YYYY-MM-DD') as at
       from zoho_ticket
      where subject ilike '%' || $1 || '%' or requester_name ilike '%' || $1 || '%' or technician_name ilike '%' || $1 || '%'
      order by created_at desc limit $2`,
    [q, limit],
  )
  return rows.map((r) => ({ ticketNo: Number(r.display_id), subject: r.subject, status: r.status, requester: r.requester_name, createdAt: r.at }))
}
