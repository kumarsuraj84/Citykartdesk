import { createAdminClient } from '@/lib/supabase/admin'
import { resolveReportAccess } from '@/lib/reporting/access'
import { getDirectReportIds } from '@/lib/queries/profiles'
import { applyScope } from '@/lib/queries/executive-dashboard'
import { fetchAllPages } from '@/lib/queries/paging'
import { getServiceFormFieldsForOrg } from '@/lib/forms/sections'
import { acFormFields, answerText, isServerRoomAc, type AcFormFields } from '@/lib/reporting/analytics/facts'
import { levelFor, type DashLevel } from '@/lib/reporting/executive/levels'
import type { AssetKind, CalAc, CalTicket } from '@/lib/reporting/executive/ac-calendar'
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
  category_id: string | null
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

  // Only the categories that go to an OEM as machine work are asset tickets: AC (kind 'ac') and genset. Other tickets of the same service (stationery, repairs ...) are not.
  const { data: kinds } = await admin.from('service_categories').select('id, auto_oem_kind').eq('org_id', orgId).in('auto_oem_kind', ['ac', 'genset'])
  const kindOfCategory = new Map(((kinds ?? []) as { id: string; auto_oem_kind: AssetKind }[]).map((c) => [c.id, c.auto_oem_kind]))
  const fields = await getServiceFormFieldsForOrg(admin, orgId)
  const byService = new Map<string, typeof fields>()
  for (const f of fields) byService.set(f.serviceId, [...(byService.get(f.serviceId) ?? []), f])
  const acFields = new Map<string, AcFormFields>([...byService.entries()].map(([id, list]) => [id, acFormFields(list)]))

  let rows: RawTicket[] = []
  let truncated = false
  if (kindOfCategory.size > 0) {
    const got = await fetchAllPages<RawTicket>((from, to) => {
      const q = admin.from('requests')
        .select('id, request_no, status, service_id, category_id, assigned_to, created_at, resolved_at, closed_at, updated_at, requester:profiles!requests_requester_id_fkey(store:stores!profiles_store_id_fkey(code, name, state, cluster, region)), snaps:request_master_snapshots(kind, snapshot)')
        .eq('org_id', orgId).in('category_id', [...kindOfCategory.keys()]).neq('status', 'cancelled')
        .or(`created_at.gte.${since},and(resolved_at.is.null,closed_at.is.null)`)
      return applyScope(q, scope, '').order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to)
    }, { maxRows: MAX_ROWS })
    rows = got.rows
    truncated = got.truncated
  }

  const snapOf = (r: RawTicket, kind: AssetKind): Snap | null => {
    const sn = (r.snaps ?? []).find((x) => x.kind === kind)?.snapshot
    return (Array.isArray(sn) ? sn[0] : null) as Snap | null
  }
  const kindOf = (r: RawTicket): AssetKind => kindOfCategory.get(r.category_id ?? '') ?? 'ac'
  // AC tickets that carry no copy of the AC (raised before the AC sheet was connected) are matched by the AC number chosen on the form
  const needForm = rows.filter((r) => kindOf(r) === 'ac' && !snapOf(r, 'ac')?.ckdesk_no).map((r) => r.id)
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
    const kind = kindOf(r)
    const st = r.requester?.store ?? null
    const snap = snapOf(r, kind)
    const store = (snap?.store_code ?? st?.code ?? '').toUpperCase()
    // an AC ticket names its AC; a genset ticket goes to every genset of the store, so the store's genset is the unit
    const acNo = kind === 'genset' ? 'Genset' : (snap?.ckdesk_no ?? formAcNo.get(r.id) ?? '').trim()
    if (kind === 'ac' && acNo && isServerRoomAc(acNo)) continue   // the Server Room AC is not one of the store's counted ACs
    const doneIso = r.resolved_at ?? r.closed_at ?? (r.status === 'resolved' || r.status === 'closed' ? r.updated_at : null)
    const who = r.assigned_to ? people.get(r.assigned_to) : undefined
    tickets.push({
      kind, id: r.id, no: r.request_no, ac: store && acNo ? `${store}|${acNo.toLowerCase()}` : '', acNo, serial: kind === 'genset' ? '' : (snap?.serial?.trim() ?? ''),
      store, storeName: st?.name ?? store, region: set(st?.region), cluster: set(st?.cluster), state: set(st?.state),
      created: new Date(r.created_at).getTime(), resolved: doneIso ? new Date(doneIso).getTime() : null,
      fixedBy: who ? (who.company ? companyName.get(who.company) ?? who.name : who.name) : '', status: r.status,
    })
  }

  // the machines of the AC and Genset sheets: all of them for an administrator; for anyone else only the stores they have tickets for (and their own store)
  let myStore: string | null = null
  if (myStoreId) {
    const { data } = await admin.from('stores').select('code').eq('id', myStoreId).maybeSingle()
    myStore = (data?.code as string | undefined)?.toUpperCase() ?? null
  }
  const allowed = scope.kind === 'all' ? null : new Set<string>([...tickets.map((t) => t.store).filter(Boolean), ...(myStore ? [myStore] : [])])
  const units = await fetchAllPages<{ store_code: string; ckdesk_no: string; serial: string | null; brand: string | null; tonnage: string | null; region: string | null; cluster: string | null; state: string | null; city: string | null }>(
    (from, to) => admin.from('master_ac_units').select('store_code, ckdesk_no, serial, brand, tonnage, region, cluster, state, city')
      .eq('org_id', orgId).eq('is_active', true).is('removed_at', null).order('id', { ascending: true }).range(from, to), { maxRows: MAX_ROWS })
  const gensets = await fetchAllPages<{ store_code: string; serial: string | null; brand: string | null; kva: string | null }>(
    (from, to) => admin.from('master_gensets').select('store_code, serial, brand, kva').eq('org_id', orgId).is('removed_at', null).order('id', { ascending: true }).range(from, to), { maxRows: MAX_ROWS })
  const storeInfo = new Map<string, { name: string; region: string; cluster: string; state: string; city: string }>()
  const storeRows = await fetchAllPages<{ code: string; name: string; region: string | null; cluster: string | null; state: string | null; city: string | null }>(
    (from, to) => admin.from('stores').select('code, name, region, cluster, state, city').eq('org_id', orgId).order('code', { ascending: true }).range(from, to), { maxRows: MAX_ROWS })
  for (const sr of storeRows.rows) storeInfo.set(sr.code.toUpperCase(), { name: sr.name, region: set(sr.region), cluster: set(sr.cluster), state: set(sr.state), city: sr.city?.trim() ?? '' })
  const fleet: CalAc[] = []
  for (const u of units.rows) {
    const store = u.store_code.toUpperCase()
    if (allowed && !allowed.has(store)) continue
    if (isServerRoomAc(u.ckdesk_no)) continue
    fleet.push({
      kind: 'ac', key: `${store}|${u.ckdesk_no.trim().toLowerCase()}`, store, storeName: storeInfo.get(store)?.name ?? store, no: u.ckdesk_no.trim(), serial: u.serial?.trim() ?? '',
      label: acLabel(u.ckdesk_no.trim(), u.brand, u.tonnage), region: set(u.region), cluster: set(u.cluster), state: set(u.state), city: u.city?.trim() ?? '',
    })
  }
  // gensets: the place comes from the Store Master (the Genset sheet has none); a genset ticket is matched to its store
  gensets.rows.forEach((g, i) => {
    const store = g.store_code.toUpperCase()
    if (allowed && !allowed.has(store)) return
    const si = storeInfo.get(store)
    fleet.push({
      kind: 'genset', key: `${store}|genset|${i}`, store, storeName: si?.name ?? store, no: 'Genset', serial: g.serial?.trim() ?? '',
      label: `Genset${g.brand ? ` - ${g.brand}` : ''}${g.kva ? ` ${g.kva} KVA` : ''}`, region: si?.region ?? NOT_SET, cluster: si?.cluster ?? NOT_SET, state: si?.state ?? NOT_SET, city: si?.city ?? '',
    })
  })
  return { level, now, tickets, fleet, myStore, truncated: truncated || units.truncated || gensets.truncated || storeRows.truncated }
}
