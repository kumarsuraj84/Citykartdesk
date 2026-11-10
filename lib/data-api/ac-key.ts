// The `ac_key` of AC tickets for the data API: "STORE|ac number" in lower case, the same key the AC Calendar of the Smart Dashboard uses for "which AC is this ticket about".
// Read-only. The AC number comes from the copy of the AC-sheet row saved on the ticket; tickets raised before the AC sheet was connected are matched by the AC number answered on the form.
// A ticket that is not an AC ticket (any other category, or a genset) or that does not say which AC has no key. The Server Room AC keeps its key (it has its own flag in `ac_units`).
import { getServiceFormFieldsForOrg } from '@/lib/forms/sections'
import { acFormFields, answerText, type AcFormFields } from '@/lib/reporting/analytics/facts'
import { assetKindByCategory } from '@/lib/programs/asset-kind'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }
type Row = Record<string, unknown>
const CHUNK = 150

/** The key of one AC: store code (upper case) + AC number (trimmed, lower case); '' when either is missing. */
export function acKeyOf(storeCode: string | null | undefined, acNo: string | null | undefined): string {
  const s = (storeCode ?? '').trim().toUpperCase()
  const n = (acNo ?? '').trim().toLowerCase()
  return s && n ? `${s}|${n}` : ''
}

interface SnapshotRow { request_id: string; kind: string; snapshot: unknown }
const firstOf = (snapshot: unknown): { store_code?: string; ckdesk_no?: string } | null => (Array.isArray(snapshot) ? (snapshot[0] as { store_code?: string; ckdesk_no?: string } | undefined) ?? null : null)

/** request id -> AC key, for the AC tickets among `rows` (raw ticket rows with id, category_id, service_id, requester_id). `storeOfProfile` is the store code of each requester. */
export async function acKeysForRequests(db: Db, orgId: string, rows: Row[], storeOfProfile: Map<string, string>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (rows.length === 0) return out

  // which categories are AC work: the "AC" Vendor Program (or the old category setting); genset categories are not AC
  const [cats, progs] = await Promise.all([
    db.from('service_categories').select('id, auto_oem_kind, program_id').eq('org_id', orgId).or('auto_oem_kind.in.(ac,genset),program_id.not.is.null'),
    db.from('vendor_programs').select('id, name').eq('org_id', orgId),
  ])
  if (cats.error) throw new Error(`read categories: ${cats.error.message}`)
  if (progs.error) throw new Error(`read programs: ${progs.error.message}`)
  const kindOf = assetKindByCategory((cats.data ?? []) as { id: string; auto_oem_kind: string | null; program_id: string | null }[], (progs.data ?? []) as { id: string; name: string }[])
  const acRows = rows.filter((r) => kindOf.get(String(r.category_id ?? '')) === 'ac')
  if (acRows.length === 0) return out

  const snapNo = new Map<string, { store: string; no: string }>()
  const ids = acRows.map((r) => String(r.id))
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await db.from('request_master_snapshots').select('request_id, kind, snapshot').eq('kind', 'ac').in('request_id', ids.slice(i, i + CHUNK))
    if (res.error) throw new Error(`read AC copies: ${res.error.message}`)
    for (const s of (res.data ?? []) as SnapshotRow[]) {
      const f = firstOf(s.snapshot)
      snapNo.set(s.request_id, { store: (f?.store_code ?? '').trim(), no: (f?.ckdesk_no ?? '').trim() })
    }
  }

  // tickets whose AC copy has no AC number: the AC number answered on the form
  const needForm = acRows.filter((r) => !snapNo.get(String(r.id))?.no)
  const formNo = new Map<string, string>()
  if (needForm.length > 0) {
    const fields = await getServiceFormFieldsForOrg(db, orgId)
    const byService = new Map<string, typeof fields>()
    for (const f of fields) byService.set(f.serviceId, [...(byService.get(f.serviceId) ?? []), f])
    const acFields = new Map<string, AcFormFields>([...byService.entries()].map(([id, list]) => [id, acFormFields(list)]))
    const serviceOf = new Map(needForm.map((r) => [String(r.id), String(r.service_id ?? '')]))
    const needIds = needForm.map((r) => String(r.id))
    for (let i = 0; i < needIds.length; i += CHUNK) {
      const res = await db.from('requests').select('id, form_data').in('id', needIds.slice(i, i + CHUNK))
      if (res.error) throw new Error(`read AC answers: ${res.error.message}`)
      for (const x of (res.data ?? []) as { id: string; form_data: Record<string, unknown> | null }[]) {
        const f = acFields.get(serviceOf.get(x.id) ?? '')?.acNo
        const v = f ? answerText((x.form_data ?? {})[f.id], f.options) : ''
        if (v) formNo.set(x.id, v)
      }
    }
  }

  for (const r of acRows) {
    const id = String(r.id)
    const snap = snapNo.get(id)
    const no = snap?.no || formNo.get(id) || ''
    const store = snap?.store || storeOfProfile.get(String(r.requester_id ?? '')) || ''
    const key = acKeyOf(store, no)
    if (key) out.set(id, key)
  }
  return out
}
