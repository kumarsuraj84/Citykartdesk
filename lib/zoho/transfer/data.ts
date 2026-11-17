import 'server-only'
/**
 * The data the Zoho -> CK Desk mapping and preview screens need. STAGE 1: this file only READS (the Zoho database through its read-only login,
 * and CK Desk's own mapping tables / services / people). It never writes a ticket and never writes to Zoho.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { listAuthEmails } from '@/lib/auth/emails'
import { resolveFormSections } from '@/lib/forms/sections'
import type { FormField } from '@/types'
import { zohoQuery } from '@/lib/zoho/db'
import { SERVICE_FIELDS } from '@/lib/zoho/queries'
import { atOfRaw, describeRaw, msToIso, nameOf, whoOfRaw } from './data-pure'
import { zohoUdfLabel, ZOHO_UDF_IN_NAMED_COLUMN } from './udf-labels'
import { categoryKey, fieldKey, itemKey, serviceKey, type CkService, type CkTemplate, type Mappings, type PersonMatch, type ZohoTicketForPlan } from './plan'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: any }
const db = () => createAdminClient() as unknown as AnyClient

// ── CK Desk side ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type CkFieldOption = { id: string; label: string; type: string }
export type CkTemplateFull = CkTemplate & { fields: CkFieldOption[] }
export type CkCategory = { id: string; name: string }
export type CkCatalogue = {
  services: CkService[]
  templates: CkTemplateFull[]
  /** the categories each service uses (taken from its tagged sub-categories) */
  categoriesOfService: Record<string, CkCategory[]>
}

const NOT_INPUT = new Set(['store_address', 'file'])

export async function loadCkCatalogue(orgId: string): Promise<CkCatalogue> {
  const [svcRes, tplRes] = await Promise.all([
    db().from('services').select('id, name, default_priority, template_id, tags:service_sub_category_tags(sub_category:service_sub_categories(id, name, category_id, sla_priority, is_active, category:service_categories(id, name)))').eq('org_id', orgId).eq('is_active', true).order('name'),
    db().from('form_templates').select('id, name, form_sections, is_active').eq('org_id', orgId).order('name'),
  ])
  type SubRow = { id: string; name: string; category_id: string; sla_priority: string | null; is_active: boolean; category: { id: string; name: string } | null }
  const services: CkService[] = ((svcRes.data ?? []) as { id: string; name: string; default_priority: string; template_id: string | null; tags: { sub_category: SubRow | null }[] }[]).map((s) => ({
    id: s.id, name: s.name, defaultPriority: s.default_priority, templateId: s.template_id,
    subCategories: (s.tags ?? []).map((t) => t.sub_category).filter((x): x is SubRow => !!x && x.is_active !== false)
      .map((x) => ({ id: x.id, name: x.name, categoryId: x.category_id, categoryName: x.category?.name ?? '', slaPriority: x.sla_priority }))
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.name.localeCompare(b.name)),
  }))
  const templates: CkTemplateFull[] = ((tplRes.data ?? []) as { id: string; name: string; form_sections: unknown }[]).map((t) => ({
    id: t.id, name: t.name,
    fields: resolveFormSections({ form_sections: t.form_sections }).flatMap((sec) => sec.fields as FormField[])
      .filter((f) => !NOT_INPUT.has(f.type)).map((f) => ({ id: f.id, label: f.label || f.id, type: f.type })),
  }))
  const categoriesOfService: Record<string, CkCategory[]> = {}
  for (const s of services) {
    const seen = new Map<string, CkCategory>()
    for (const sc of s.subCategories) if (!seen.has(sc.categoryId)) seen.set(sc.categoryId, { id: sc.categoryId, name: sc.categoryName })
    categoriesOfService[s.id] = [...seen.values()]
  }
  return { services, templates, categoriesOfService }
}

// ── the saved mapping ─────────────────────────────────────────────────────────────────────────────────────────────────

export type SavedMapping = {
  templates: { zoho_template: string; form_template_id: string }[]
  services: { zoho_template: string; zoho_category: string; service_id: string }[]
  categories: { zoho_template: string; zoho_category: string; zoho_subcategory: string; category_id: string }[]
  items: { zoho_template: string; zoho_category: string; zoho_subcategory: string; zoho_item: string; sub_category_id: string }[]
  fields: { zoho_template: string; zoho_field: string; ck_field_id: string }[]
  statuses: { zoho_value: string; ck_value: string }[]
  people: { kind: 'requester' | 'technician'; zoho_key: string; zoho_name: string | null; profile_id: string }[]
}

export async function loadSavedMapping(orgId: string): Promise<SavedMapping> {
  const q = async (table: string, cols: string, extra?: (b: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let b = db().from(table).select(cols).eq('org_id', orgId)
    if (extra) b = extra(b)
    const { data } = await b
    return (data ?? []) as never[]
  }
  const [templates, services, categories, items, fields, statuses, people] = await Promise.all([
    q('zoho_map_templates', 'zoho_template, form_template_id'),
    q('zoho_map_services', 'zoho_template, zoho_category, service_id'),
    q('zoho_map_categories', 'zoho_template, zoho_category, zoho_subcategory, category_id'),
    q('zoho_map_items', 'zoho_template, zoho_category, zoho_subcategory, zoho_item, sub_category_id'),
    q('zoho_map_fields', 'zoho_template, zoho_field, ck_field_id'),
    q('zoho_map_values', 'zoho_value, ck_value', (b) => b.eq('kind', 'status')),
    q('zoho_map_people', 'kind, zoho_key, zoho_name, profile_id'),
  ])
  return { templates, services, categories, items, fields, statuses, people }
}

export function toMappings(m: SavedMapping): Mappings {
  return {
    templates: new Map(m.templates.map((r) => [r.zoho_template, r.form_template_id])),
    services: new Map(m.services.map((r) => [serviceKey(r.zoho_template, r.zoho_category), r.service_id])),
    categories: new Map(m.categories.map((r) => [categoryKey(r.zoho_template, r.zoho_category, r.zoho_subcategory), r.category_id])),
    items: new Map(m.items.map((r) => [itemKey(r.zoho_template, r.zoho_category, r.zoho_subcategory, r.zoho_item), r.sub_category_id])),
    fields: new Map(m.fields.map((r) => [fieldKey(r.zoho_template, r.zoho_field), r.ck_field_id])),
    statuses: new Map(m.statuses.map((r) => [r.zoho_value, r.ck_value])),
  }
}

// ── Zoho side (read only) ──────────────────────────────────────────────────────────────────────────────────────────────

export type ZohoTreeRow = { template: string; category: string; subcategory: string; item: string; tickets: number }
export type ZohoFieldUse = { template: string; field: string; label: string; tickets: number }
export type ZohoFacts = {
  total: number
  templates: { template: string; tickets: number }[]
  tree: ZohoTreeRow[]
  statuses: { status: string; tickets: number }[]
  fieldUse: ZohoFieldUse[]
}

const n = (v: unknown) => Number(v ?? 0)

/** Limits what is read to the tickets of one search: the SQL "where" and its values (see buildTicketWhere). */
export type TicketScope = { where: string[]; p: unknown[] }

export async function loadZohoFacts(scope?: TicketScope): Promise<ZohoFacts> {
  const w = scope && scope.where.length ? scope.where.join(' and ') : ''
  const sp = scope?.p ?? []
  const cols = SERVICE_FIELDS.map((f, i) => `count(*) filter (where "${f.col}" is not null and btrim("${f.col}"::text) <> '') as c${i}`).join(', ')
  const [tpl, tree, st, use, udf] = await Promise.all([
    zohoQuery<{ t: string; n: string }>(`select coalesce(template, '') as t, count(*)::text as n from zoho_ticket ${w ? 'where ' + w : ''} group by 1 order by count(*) desc`, sp),
    zohoQuery<{ t: string; c: string; s: string; i: string; n: string }>(
      `select coalesce(template, '') t, coalesce(category, '') c, coalesce(subcategory, '') s, coalesce(item, '') i, count(*)::text n from zoho_ticket ${w ? 'where ' + w : ''} group by 1, 2, 3, 4 order by 1, 2, 3, 4`, sp),
    zohoQuery<{ s: string; n: string }>(`select coalesce(status, '') as s, count(*)::text as n from zoho_ticket ${w ? 'where ' + w : ''} group by 1 order by count(*) desc`, sp),
    zohoQuery<Record<string, string>>(`select coalesce(template, '') as t, ${cols} from zoho_ticket ${w ? 'where ' + w : ''} group by 1`, sp),
    zohoQuery<{ t: string; k: string; n: string }>(
      `select coalesce(template, '') t, k, count(*)::text n
         from zoho_ticket, jsonb_object_keys(case when jsonb_typeof(udf) = 'object' then udf else '{}'::jsonb end) k
        where coalesce(udf ->> k, '') <> '' ${w ? 'and (' + w + ')' : ''} group by 1, 2`, sp),
  ])
  const fieldUse: ZohoFieldUse[] = []
  for (const r of use) SERVICE_FIELDS.forEach((f, i) => { const c = n(r[`c${i}`]); if (c > 0) fieldUse.push({ template: r.t, field: f.col, label: f.label, tickets: c }) })
  for (const r of udf) if (!ZOHO_UDF_IN_NAMED_COLUMN.has(r.k)) fieldUse.push({ template: r.t, field: `udf:${r.k}`, label: zohoUdfLabel(r.k), tickets: n(r.n) })
  return {
    total: tpl.reduce((a, r) => a + n(r.n), 0),
    templates: tpl.map((r) => ({ template: r.t, tickets: n(r.n) })),
    tree: tree.map((r) => ({ template: r.t, category: r.c, subcategory: r.s, item: r.i, tickets: n(r.n) })),
    statuses: st.map((r) => ({ status: r.s, tickets: n(r.n) })),
    fieldUse,
  }
}

// ── people ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type CkPerson = { id: string; name: string; email: string | null; active: boolean; role: string }
export type PeopleDirectory = { people: CkPerson[]; byEmail: Map<string, CkPerson>; byName: Map<string, CkPerson[]>; emailsRead: boolean }

export async function loadPeopleDirectory(orgId: string): Promise<PeopleDirectory> {
  const admin = db()
  const { data } = await admin.from('profiles').select('id, full_name, is_active, role').eq('org_id', orgId)
  const rows = (data ?? []) as { id: string; full_name: string | null; is_active: boolean; role: string }[]
  const scanned = await listAuthEmails(admin as never, rows.map((r) => r.id))
  const emails = scanned.ok ? scanned.value : new Map<string, string>()
  const people: CkPerson[] = rows.map((r) => ({ id: r.id, name: r.full_name ?? '(no name)', email: emails.get(r.id) ?? null, active: r.is_active, role: r.role }))
  const byEmail = new Map<string, CkPerson>()
  const byName = new Map<string, CkPerson[]>()
  for (const p of people) {
    if (p.email) byEmail.set(p.email.toLowerCase(), p)
    const k = p.name.trim().toLowerCase()
    byName.set(k, [...(byName.get(k) ?? []), p])
  }
  return { people, byEmail, byName, emailsRead: scanned.ok }
}

export const personKey = (email: string | null | undefined, name: string | null | undefined) =>
  String(email ?? '').trim().toLowerCase() || String(name ?? '').trim().toLowerCase()

/** A saved hand match first, then the e-mail, then an exact full name that only one person has. */
export function matchPerson(dir: PeopleDirectory, saved: Map<string, CkPerson>, who: { email: string | null; name: string | null }): PersonMatch & { person?: CkPerson } {
  const key = personKey(who.email, who.name)
  if (!key) return { how: 'none' }
  const hand = saved.get(key)
  if (hand) return { how: 'saved', profileName: hand.name, person: hand }
  const email = String(who.email ?? '').trim().toLowerCase()
  const byEmail = email ? dir.byEmail.get(email) : undefined
  if (byEmail) return { how: 'email', profileName: byEmail.name, person: byEmail }
  const named = dir.byName.get(String(who.name ?? '').trim().toLowerCase())
  if (named && named.length === 1) return { how: 'name', profileName: named[0].name, person: named[0] }
  return { how: 'none' }
}

export function savedPeopleMap(m: SavedMapping, kind: 'requester' | 'technician', dir: PeopleDirectory): Map<string, CkPerson> {
  const byId = new Map(dir.people.map((p) => [p.id, p]))
  const out = new Map<string, CkPerson>()
  for (const r of m.people) if (r.kind === kind) { const p = byId.get(r.profile_id); if (p) out.set(r.zoho_key, p) }
  return out
}

export type ZohoPersonRow = { key: string; name: string | null; email: string | null; tickets: number }

/** The distinct people on Zoho tickets (as requester or as technician), with how many tickets each has. */
export async function loadZohoPeople(kind: 'requester' | 'technician', scope?: TicketScope): Promise<ZohoPersonRow[]> {
  const w = scope && scope.where.length ? ' and (' + scope.where.join(' and ') + ')' : ''
  const nameCol = kind === 'requester' ? 'requester_name' : 'technician_name'
  const mailCol = kind === 'requester' ? 'requester_email' : 'technician_email'
  const rows = await zohoQuery<{ k: string; name: string | null; email: string | null; n: string }>(
    `select lower(coalesce(nullif(btrim(${mailCol}), ''), btrim(${nameCol}))) as k, max(btrim(${nameCol})) as name, max(btrim(${mailCol})) as email, count(*)::text as n
       from zoho_ticket where coalesce(nullif(btrim(${mailCol}), ''), nullif(btrim(${nameCol}), '')) is not null${w} group by 1 order by count(*) desc`, scope?.p ?? [])
  return rows.map((r) => ({ key: r.k, name: r.name, email: r.email, tickets: n(r.n) }))
}

// ── tickets for the preview ──────────────────────────────────────────────────────────────────────────────────────────────

export type MoveFilters = {
  numbers?: string          // "48213, 48220-48230"
  status?: string
  template?: string
  category?: string
  technician?: string
  requester?: string
  from?: string             // yyyy-mm-dd, created on or after
  to?: string               // yyyy-mm-dd, created on or before
  notMoved?: boolean
  /** 'not' = only tickets not moved yet, 'only' = only tickets already moved (a plain notMoved: true means 'not') */
  moved?: 'not' | 'only'
}

/** "48213, 48220-48230" -> single numbers and ranges. Anything that is not a plain number is ignored. */
export function parseNumberList(text: string | undefined): { singles: number[]; ranges: [number, number][] } {
  const singles: number[] = []
  const ranges: [number, number][] = []
  for (const part of String(text ?? '').split(/[\s,;]+/).filter(Boolean)) {
    const m = part.replace(/^#/, '').match(/^(\d{1,18})(?:-(\d{1,18}))?$/)
    if (!m) continue
    const a = Number(m[1])
    if (!Number.isSafeInteger(a)) continue
    if (m[2]) { const b = Number(m[2]); if (Number.isSafeInteger(b) && b >= a) ranges.push([a, b]) } else singles.push(a)
  }
  return { singles: singles.slice(0, 500), ranges: ranges.slice(0, 50) }
}

export const PREVIEW_LIMIT = 200

/** The SQL "where" (and its values) for a search of Zoho tickets. One place, so the Move page and the Mapping page always mean the same tickets. */
export function buildTicketWhere(f: MoveFilters, movedNumbers: number[], opts: { beforeNo?: number } = {}): { where: string[]; p: unknown[] } {
  const where: string[] = []
  const p: unknown[] = []
  const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.split('$$').join(`$${p.length}`)) }
  const { singles, ranges } = parseNumberList(f.numbers)
  if (singles.length || ranges.length) {
    const ors: string[] = []
    if (singles.length) { p.push(singles); ors.push(`display_id = any($${p.length}::bigint[])`) }
    for (const [a, b] of ranges) { p.push(a, b); ors.push(`display_id between $${p.length - 1} and $${p.length}`) }
    where.push(`(${ors.join(' or ')})`)
  }
  if (f.status) add(`coalesce(status, '') = $$`, f.status)
  if (f.template) add(`coalesce(template, '') = $$`, f.template)
  if (f.category) add(`coalesce(category, '') = $$`, f.category)
  if (f.technician) add(`technician_name ilike '%' || $$ || '%'`, f.technician)
  if (f.requester) add(`(requester_name ilike '%' || $$ || '%' or requester_email ilike '%' || $$ || '%')`, f.requester)
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) add(`created_at >= $$::date`, f.from)
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) add(`created_at < ($$::date + 1)`, f.to)
  const wantMoved = f.moved ?? (f.notMoved ? 'not' : undefined)
  if (wantMoved === 'not' && movedNumbers.length) add(`display_id <> all($$::bigint[])`, movedNumbers)
  if (wantMoved === 'only') { if (movedNumbers.length) add(`display_id = any($$::bigint[])`, movedNumbers); else where.push('false') }
  if (opts.beforeNo) add(`display_id < $$`, opts.beforeNo)
  return { where, p }
}

/** True when the search names at least one condition (a search with none means "everything"). */
export function hasTicketFilter(f: MoveFilters): boolean {
  return !!(f.numbers || f.status || f.template || f.category || f.technician || f.requester || f.from || f.to || f.moved || f.notMoved)
}

export async function loadTicketsForPreview(f: MoveFilters, movedNumbers: number[], opts: { limit?: number; beforeNo?: number } = {}): Promise<{ total: number; rows: ZohoTicketForPlan[]; truncated: boolean }> {
  const limit = Math.min(Math.max(1, opts.limit ?? PREVIEW_LIMIT), 1000)
  const { where, p } = buildTicketWhere(f, movedNumbers, { beforeNo: opts.beforeNo })

  const fieldCols = SERVICE_FIELDS.map((x) => `"${x.col}"`).join(', ')
  const rows = await zohoQuery<Record<string, unknown>>(
    `select display_id, template, category, subcategory, item, status, priority, subject, created_at, resolved_at,
            requester_name, requester_email, technician_name, technician_email, udf, ${fieldCols}, count(*) over() as total
       from zoho_ticket ${where.length ? 'where ' + where.join(' and ') : ''}
      order by display_id desc limit ${limit}`,
    p,
  )
  const text = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v).trim())
  const out: ZohoTicketForPlan[] = rows.map((r) => {
    const fields: Record<string, string> = {}
    for (const x of SERVICE_FIELDS) { const v = text(r[x.col]); if (v) fields[x.col] = v }
    const udf = r.udf && typeof r.udf === 'object' ? (r.udf as Record<string, unknown>) : {}
    for (const [k, v] of Object.entries(udf)) { if (ZOHO_UDF_IN_NAMED_COLUMN.has(k)) continue; const t = text(v); if (t && t !== 'null') fields[`udf:${k}`] = t }
    return {
      displayId: Number(r.display_id), template: text(r.template) || null, category: text(r.category) || null, subcategory: text(r.subcategory) || null, item: text(r.item) || null,
      status: text(r.status) || null, priority: text(r.priority) || null, subject: text(r.subject) || null,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : null, resolvedAt: r.resolved_at instanceof Date ? r.resolved_at.toISOString() : null,
      requesterName: text(r.requester_name) || null, requesterEmail: text(r.requester_email) || null, technicianName: text(r.technician_name) || null, technicianEmail: text(r.technician_email) || null, fields,
    }
  })
  const total = rows.length ? Number(rows[0].total) : 0
  return { total, rows: out, truncated: total > out.length }
}

/** The Zoho numbers (among `numbers`, or all of them) already moved. Reads CK Desk's own transfer list. */
/** A claim with no ticket behind it for this long was left by a move that stopped half way (the server was restarted): it no longer blocks the ticket. */
export const STALE_CLAIM_MS = 10 * 60 * 1000

export async function loadMovedNumbers(orgId: string, numbers?: number[]): Promise<Set<number>> {
  let b = db().from('zoho_transfers').select('zoho_ticket_no, request_id, moved_at').eq('org_id', orgId).eq('state', 'moved')
  if (numbers) b = b.in('zoho_ticket_no', numbers)
  const { data } = await b.limit(100000)
  const now = new Date().getTime()
  return new Set(
    ((data ?? []) as { zoho_ticket_no: number | string; request_id: string | null; moved_at: string }[])
      // a claim whose ticket was never made, and that is old, is not "moved": the move that took it stopped half way
      .filter((r) => r.request_id !== null || now - new Date(r.moved_at).getTime() < STALE_CLAIM_MS)
      .map((r) => Number(r.zoho_ticket_no)),
  )
}

// ── one ticket in full, for the move ───────────────────────────────────────────────────────────────────────────────────────

export type ZohoMoveDetail = {
  message: string                       // the store's message, as plain text
  respondedAt: string | null
  completedAt: string | null
  closure: { code: string; comments: string } | null
  emails: { at: string | null; kind: string | null; subject: string | null; sender: string | null; body: string }[]
  notes: { at: string | null; who: string | null; body: string }[]
  history: { at: string | null; operation: string | null; who: string | null; body: string | null }[]
  attachments: { fileName: string; storedFile: string | null; contentType: string | null; size: number | null; ok: boolean }[]
}


/** Everything about ONE Zoho ticket the move copies: the message, key times, closure, and the whole conversation. Read only. */
export async function loadZohoMoveDetail(displayId: number): Promise<ZohoMoveDetail | null> {
  const { htmlToText } = await import('@/lib/email/oem-template')
  const head = await zohoQuery<{ zoho_id: string; raw: { request?: Record<string, unknown> } | null }>(`select zoho_id, raw from zoho_ticket where display_id = $1 limit 1`, [displayId])
  if (!head[0]) return null
  const zohoId = head[0].zoho_id
  const req = (head[0].raw?.request ?? {}) as Record<string, unknown>
  const text = (html: unknown) => (typeof html === 'string' && html.trim() ? htmlToText(html).trim() : '')
  const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : null)
  const [emails, notes, history, atts] = await Promise.all([
    zohoQuery<{ at: Date | null; kind: string | null; subject: string | null; sender: string | null; body: string | null }>(
      `select sent_at as at, kind, subject, sender, body from zoho_email where ticket_zoho_id = $1 order by sent_at nulls last limit 300`, [zohoId]),
    zohoQuery<{ at: Date | null; who: string | null; body: string | null }>(
      `select created_at as at, raw -> 'created_by' ->> 'name' as who, raw ->> 'description' as body from zoho_note where ticket_zoho_id = $1 order by created_at nulls last limit 300`, [zohoId]),
    zohoQuery<{ at: Date | null; operation: string | null; who: string | null; body: string | null }>(
      `select happened_at as at, operation, coalesce(raw -> 'by' ->> 'name', raw -> 'approver' ->> 'name', raw -> 'approved_by' ->> 'name', raw -> 'rejected_by' ->> 'name', raw -> 'performed_by' ->> 'name', raw -> 'user' ->> 'name') as who, raw ->> 'description' as body from zoho_history where ticket_zoho_id = $1 order by happened_at nulls last limit 300`, [zohoId]),
    zohoQuery<{ file_name: string | null; stored_file: string | null; content_type: string | null; size: string | null; status: string | null }>(
      `select file_name, stored_file, content_type, coalesce(stored_size, declared_size)::text as size, status from zoho_attachment where ticket_zoho_id = $1 order by file_name`, [zohoId]),
  ])
  const closure = (req.closure_info ?? null) as { closure_code?: { name?: string } | string; closure_comments?: string } | null
  const code = closure ? (typeof closure.closure_code === 'string' ? closure.closure_code : closure.closure_code?.name ?? '') : ''
  return {
    message: text(req.description),
    respondedAt: msToIso(req.responded_time),
    completedAt: msToIso(req.completed_time),
    closure: closure && (code || closure.closure_comments) ? { code, comments: text(closure.closure_comments) } : null,
    emails: emails.map((e) => ({ at: iso(e.at), kind: e.kind, subject: e.subject, sender: e.sender, body: text(e.body) })),
    notes: notes.map((x) => ({ at: iso(x.at), who: x.who, body: text(x.body) })),
    history: history.map((h) => ({ at: iso(h.at), operation: h.operation, who: h.who, body: h.body && h.body !== 'null' ? text(h.body) || null : null })),
    attachments: atts.map((a) => ({ fileName: a.file_name ?? '(no name)', storedFile: a.stored_file, contentType: a.content_type, size: a.size === null ? null : Number(a.size), ok: a.status === 'ok' })),
  }
}

/** Claim / read the transfer list (CK Desk's own table). */
export async function loadTransferState(orgId: string, zohoNo: number): Promise<{ state: string; requestNo: string; requestId: string | null; movedAt: string } | null> {
  const { data } = await db().from('zoho_transfers').select('state, request_no, request_id, moved_at').eq('org_id', orgId).eq('zoho_ticket_no', zohoNo).maybeSingle()
  return data ? { state: data.state as string, requestNo: data.request_no as string, requestId: (data.request_id as string | null) ?? null, movedAt: data.moved_at as string } : null
}

// ── everything else Zoho kept on a ticket (conversation items, tasks, work logs, approvals) ─────────────────────────────────────

export type ZohoExtraItem = { at: string | null; who: string | null; kind?: string | null; text: string }
export type ZohoExtras = {
  approval: string | null
  conversations: ZohoExtraItem[]
  tasks: ZohoExtraItem[]
  worklogs: ZohoExtraItem[]
}

export async function loadZohoExtras(displayId: number): Promise<ZohoExtras> {
  const { htmlToText } = await import('@/lib/email/oem-template')
  const head = await zohoQuery<{ zoho_id: string; raw: { request?: Record<string, unknown> } | null }>(`select zoho_id, raw from zoho_ticket where display_id = $1 limit 1`, [displayId])
  if (!head[0]) return { approval: null, conversations: [], tasks: [], worklogs: [] }
  const zid = head[0].zoho_id
  const approval = nameOf(head[0].raw?.request?.approval_status) || null
  const [conv, tasks, logs] = await Promise.all([
    zohoQuery<{ at: Date | null; kind: string | null; raw: unknown }>(`select created_at as at, kind, raw from zoho_conversation where ticket_zoho_id = $1 order by created_at nulls last limit 300`, [zid]),
    zohoQuery<{ raw: unknown }>(`select raw from zoho_task where ticket_zoho_id = $1 limit 200`, [zid]),
    zohoQuery<{ raw: unknown }>(`select raw from zoho_worklog where ticket_zoho_id = $1 limit 200`, [zid]),
  ])
  const item = (raw: unknown, at: string | null = null, kind: string | null = null): ZohoExtraItem => ({ at: at ?? atOfRaw(raw), who: whoOfRaw(raw), kind, text: describeRaw(raw, htmlToText) })
  return {
    approval,
    conversations: conv.map((c) => item(c.raw, c.at instanceof Date ? c.at.toISOString() : null, c.kind)).filter((c) => c.text),
    tasks: tasks.map((t) => item(t.raw)).filter((t) => t.text),
    worklogs: logs.map((t) => item(t.raw)).filter((t) => t.text),
  }
}

export { atOfRaw, describeRaw, whoOfRaw } from './data-pure'
