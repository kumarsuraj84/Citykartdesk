import { createAdminClient } from '@/lib/supabase/admin'
import { resolveReportAccess } from '@/lib/reporting/access'
import { getDirectReportIds } from '@/lib/queries/profiles'
import { applyScope } from '@/lib/queries/executive-dashboard'
import { fetchAllPages } from '@/lib/queries/paging'
import { getServiceFormFieldsForOrg } from '@/lib/forms/sections'
import { acFormFields, answerText, isServerRoomAc, type AcFormFields } from '@/lib/reporting/analytics/facts'
import { levelFor, type DashLevel } from '@/lib/reporting/executive/levels'
import type { CalAc, CalTicket } from '@/lib/reporting/executive/ac-calendar'
import { createShortCache } from '@/lib/cache/short-ttl'
import type { ProfileWithTeams } from '@/types'

// The rows behind the AC Calendar of the Smart Dashboard: the viewer's AC tickets (which AC each one is for, when it was raised and fixed) and the ACs of the AC sheet.
// Read-only. Scope is the same as the rest of the Smart Dashboard: a store sees its own, a technician or manager their groups', an administrator everything.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

/** How far back tickets are loaded (still-open ones are always loaded). */
const LOOKBACK_DAYS = 800
const MAX_ROWS = 40_000
const CHUNK = 150

export interface AcCalendarData {
  level: DashLevel
  now: number
  tickets: CalTicket[]
  fleet: CalAc[]
  /** a store login: the store to show first */
  myStore: string | null
  truncated: boolean
}

interface RawTicket {
  id: string
  request_no: string
  status: string
  service_id: string
  assigned_to: string | null
  created_at: string
  resolved_at: string | null
  closed_at: string | null
  updated_at: string
  requester: { store: { code: string; name: string; state: string | null; cluster: string | null; region: string | null } | null } | null
  snaps: { kind: string; snapshot: unknown }[] | null
}
interface Snap { store_code?: string; ckdesk_no?: string; serial?: string | null; brand?: string | null; tonnage?: string | null }

const NOT_SET = '(Not set)'
const set = (v: string | null | undefined) => v?.trim() || NOT_SET

const acLabel = (no: string, brand?: string | null, tonnage?: string | null) => `AC ${no}${brand ? ` - ${brand}` : ''}${tonnage ? ` ${tonnage}` : ''}`

const cache = createShortCache<AcCalendarData>(60_000, 40)

export async function loadAcCalendarData(profile: ProfileWithTeams, opts: { fresh?: boolean } = {}): Promise<AcCalendarData | { error: string }> {
  const level = levelFor(profile.role)
  if (!level || !profile.org_id) return { error: "You don't have access to this dashboard." }
  const access = resolveReportAccess(profile, 'requests')
  if ('error' in access) return { error: access.error }
  let scope = access.scope
  if (profile.role === 'user') {
    const reportIds = await getDirectReportIds(profile.id)
    if (reportIds.length > 0) scope = { kind: 'reports', userId: profile.id, reportIds, techIds: [], requesterIds: [] }
  }
  const orgId: string = profile.org_id
  return cache.get(`accal|${orgId}|${level}|${JSON.stringify(scope)}|${profile.store_id ?? ''}`, () => loadRows(orgId, level, scope, profile.store_id ?? null), opts)
}

async function loadRows(orgId: string, level: DashLevel, scope: Parameters<typeof applyScope>[1], myStoreId: string | null): Promise<AcCalendarData> {
  const admin = createAdminClient() as unknown as AnyClient
  const now = Date.now()
  const since = new Date(now - LOOKBACK_DAYS * 86_400_000).toISOString()

  const { data: acServices } = await admin.from('services').select('id').eq('org_id', orgId).eq('auto_oem_routing', true)
  const acServiceIds = ((acServices ?? []) as { id: string }[]).map((s) => s.id)
  const fields = await getServiceFormFieldsForOrg(admin, orgId)
  const byService = new Map<string, typeof fields>()
  for (const f of fields) byService.set(f.serviceId, [...(byService.get(f.serviceId) ?? []), f])
  const acFields = new Map<string, AcFormFields>([...byService.entries()].map(([id, list]) => [id, acFormFields(list)]))

  let rows: RawTicket[] = []
  let truncated = false
  if (acServiceIds.length > 0) {
    const got = await fetchAllPages<RawTicket>((from, to) => {
      const q = admin.from('requests')
        .select('id, request_no, status, service_id, assigned_to, created_at, resolved_at, closed_at, updated_at, requester:profiles!requests_requester_id_fkey(store:stores!profiles_store_id_fkey(code, name, state, cluster, region)), snaps:request_master_snapshots(kind, snapshot)')
        .eq('org_id', orgId).in('service_id', acServiceIds).neq('status', 'cancelled')
        .or(`created_at.gte.${since},and(resolved_at.is.null,closed_at.is.null)`)
      return applyScope(q, scope, '').order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
    }, { maxRows: MAX_ROWS })
    rows = got.rows
    truncated = got.truncated
  }

  // tickets that carry no copy of the AC (raised before the AC sheet was connected) are matched by the AC number chosen on the form
  const snapOf = (r: RawTicket): Snap | null => {
    const s = (r.snaps ?? []).find((x) => x.kind === 'ac')?.snapshot
    return (Array.isArray(s) ? s[0] : null) as Snap | null
  }
  const needForm = rows.filter((r) => !snapOf(r)?.ckdesk_no).map((r) => r.id)
  const formAcNo = new Map<string, string>()
  const serviceOf = new Map(rows.map((r) => [r.id, r.service_id]))
  for (let i = 0; i < needForm.length; i += CHUNK) {
    const { data } = await admin.from('requests').select('id, form_data').in('id', needForm.slice(i, i + CHUNK))
    for (const x of (data ?? []) as { id: string; form_data: Record<string, unknown> | null }[]) {
      const f = acFields.get(serviceOf.get(x.id) ?? '')?.acNo
      const v = f ? answerText((x.form_data ?? {})[f.id], f.options) : ''
      if (v) formAcNo.set(x.id, v)
    }
  }

  // who fixed it: the vendor company if the technician belongs to one, else the technician
  const assigneeIds = [...new Set(rows.map((r) => r.assigned_to).filter((x): x is string => !!x))]
  const people = new Map<string, { name: string; company: string | null }>()
  const companyIds = new Set<string>()
  for (let i = 0; i < assigneeIds.length; i += CHUNK) {
    const { data } = await admin.from('profiles').select('id, full_name, vendor_company_id').in('id', assigneeIds.slice(i, i + CHUNK))
    for (const p of (data ?? []) as { id: string; full_name: string; vendor_company_id: string | null }[]) {
      people.set(p.id, { name: p.full_name, company: p.vendor_company_id })
      if (p.vendor_company_id) companyIds.add(p.vendor_company_id)
    }
  }
  const companyName = new Map<string, string>()
  if (companyIds.size > 0) {
    const { data } = await admin.from('vendor_companies').select('id, name').in('id', [...companyIds])
    for (const c of (data ?? []) as { id: string; name: string }[]) companyName.set(c.id, c.name)
  }

  const tickets: CalTicket[] = []
  for (const r of rows) {
    const st = r.requester?.store ?? null
    const snap = snapOf(r)
    const store = (snap?.store_code ?? st?.code ?? '').toUpperCase()
    const acNo = (snap?.ckdesk_no ?? formAcNo.get(r.id) ?? '').trim()
    if (acNo && isServerRoomAc(acNo)) continue   // the Server Room AC is not one of the store's counted ACs
    const doneIso = r.resolved_at ?? r.closed_at ?? (r.status === 'resolved' || r.status === 'closed' ? r.updated_at : null)
    const who = r.assigned_to ? people.get(r.assigned_to) : undefined
    tickets.push({
      id: r.id, no: r.request_no, ac: store && acNo ? `${store}|${acNo.toLowerCase()}` : '', acNo, serial: snap?.serial?.trim() ?? '',
      store, storeName: st?.name ?? store, region: set(st?.region), cluster: set(st?.cluster), state: set(st?.state),
      created: new Date(r.created_at).getTime(), resolved: doneIso ? new Date(doneIso).getTime() : null,
      fixedBy: who ? (who.company ? companyName.get(who.company) ?? who.name : who.name) : '', status: r.status,
    })
  }

  // the ACs of the AC sheet: all of them for an administrator; for anyone else only the stores they have tickets for (and their own store)
  let myStore: string | null = null
  if (myStoreId) {
    const { data } = await admin.from('stores').select('code').eq('id', myStoreId).maybeSingle()
    myStore = (data?.code as string | undefined)?.toUpperCase() ?? null
  }
  const allowed = scope.kind === 'all' ? null : new Set<string>([...tickets.map((t) => t.store).filter(Boolean), ...(myStore ? [myStore] : [])])
  const units = await fetchAllPages<{ store_code: string; ckdesk_no: string; serial: string | null; brand: string | null; tonnage: string | null; region: string | null; cluster: string | null; state: string | null; city: string | null }>(
    (from, to) => admin.from('master_ac_units').select('store_code, ckdesk_no, serial, brand, tonnage, region, cluster, state, city')
      .eq('org_id', orgId).eq('is_active', true).is('removed_at', null).order('id', { ascending: true }).range(from, to), { maxRows: MAX_ROWS })
  const storeNames = new Map<string, string>()
  const storeRows = await fetchAllPages<{ code: string; name: string }>((from, to) => admin.from('stores').select('code, name').eq('org_id', orgId).order('code', { ascending: true }).range(from, to), { maxRows: MAX_ROWS })
  for (const s of storeRows.rows) storeNames.set(s.code.toUpperCase(), s.name)
  const fleet: CalAc[] = []
  for (const u of units.rows) {
    const store = u.store_code.toUpperCase()
    if (allowed && !allowed.has(store)) continue
    if (isServerRoomAc(u.ckdesk_no)) continue
    fleet.push({
      key: `${store}|${u.ckdesk_no.trim().toLowerCase()}`, store, storeName: storeNames.get(store) ?? store, no: u.ckdesk_no.trim(), serial: u.serial?.trim() ?? '',
      label: acLabel(u.ckdesk_no.trim(), u.brand, u.tonnage), region: set(u.region), cluster: set(u.cluster), state: set(u.state), city: u.city?.trim() ?? '',
    })
  }
  return { level, now, tickets, fleet, myStore, truncated: truncated || units.truncated }
}
