import ExcelJS from 'exceljs'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { totalOf } from './lines'

// The PO register: every purchase order a vendor asked for, with its number, date, ticket, store, items and amount (without GST).
// A vendor sees his own (a vendor manager: his company's); Citykart's technicians, managers and administrators see all of them. Server only.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type PoRegisterRow = {
  id: string
  po_number: string | null
  po_date: string | null
  status: 'pending' | 'revision_requested' | 'approved' | 'rejected' | 'received' | 'cancelled' | 'superseded' | 'withdrawn'
  version: number
  request_id: string
  request_no: string
  store_code: string | null
  store_name: string | null
  vendor_name: string
  technician: string | null
  items: string
  total: number
  requested_at: string
  decided_at: string | null
  decision_reason: string | null
}

export const PO_STATUS_LABELS: Record<PoRegisterRow['status'], string> = {
  approved: 'PO issued', pending: 'Quote waiting for approval', revision_requested: 'Revised price asked', rejected: 'Quote rejected', received: 'Closed', cancelled: 'Closed',
  superseded: 'Quote replaced by a newer version', withdrawn: 'Quote withdrawn',
}

type Viewer = { kind: 'vendor' } | { kind: 'staff'; orgId: string }

const MAX_ROWS = 5000

export async function loadPoRegister(viewer: Viewer): Promise<PoRegisterRow[]> {
  const admin = createAdminClient() as unknown as Db
  let query = admin.from('vendor_requests').select('id, status, version, request_id, po_number, po_date, created_by, created_at, decided_at, decision_reason, org_id').eq('kind', 'po').order('created_at', { ascending: false }).limit(MAX_ROWS)
  if (viewer.kind === 'staff') {
    query = query.eq('org_id', viewer.orgId)
  } else {
    // a vendor reads the POs of the tickets row security lets him read (his own, or his company's for a manager)
    const supabase = await createClient()
    const { data: visible } = await supabase.from('requests').select('id').limit(MAX_ROWS)
    const ids = ((visible ?? []) as { id: string }[]).map((r) => r.id)
    if (ids.length === 0) return []
    query = query.in('request_id', ids)
  }
  const { data: vrs } = await query
  const rows = (vrs ?? []) as { id: string; status: PoRegisterRow['status']; version: number; request_id: string; po_number: string | null; po_date: string | null; created_by: string | null; created_at: string; decided_at: string | null; decision_reason: string | null }[]
  if (rows.length === 0) return []

  const requestIds = [...new Set(rows.map((r) => r.request_id))]
  const [{ data: reqs }, { data: items }] = await Promise.all([
    admin.from('requests').select('id, request_no, requester_id, assigned_to').in('id', requestIds),
    admin.from('vendor_request_items').select('vendor_request_id, line_no, item_name, qty, price_excl_gst').in('vendor_request_id', rows.map((r) => r.id)).order('line_no', { ascending: true }),
  ])
  const reqById = new Map(((reqs ?? []) as { id: string; request_no: string; requester_id: string; assigned_to: string | null }[]).map((r) => [r.id, r]))
  const people = [...new Set([...reqById.values()].flatMap((r) => [r.requester_id, r.assigned_to]).filter((v): v is string => !!v))]
  const { data: profs } = await admin.from('profiles').select('id, full_name, store_id, vendor_company_id').in('id', people)
  const profById = new Map(((profs ?? []) as { id: string; full_name: string; store_id: string | null; vendor_company_id: string | null }[]).map((p) => [p.id, p]))
  const storeIds = [...new Set([...profById.values()].map((p) => p.store_id).filter((v): v is string => !!v))]
  const companyIds = [...new Set([...profById.values()].map((p) => p.vendor_company_id).filter((v): v is string => !!v))]
  const [{ data: stores }, { data: companies }] = await Promise.all([
    storeIds.length ? admin.from('stores').select('id, code, name').in('id', storeIds) : Promise.resolve({ data: [] }),
    companyIds.length ? admin.from('vendor_companies').select('id, name').in('id', companyIds) : Promise.resolve({ data: [] }),
  ])
  const storeById = new Map(((stores ?? []) as { id: string; code: string; name: string }[]).map((s) => [s.id, s]))
  const companyById = new Map(((companies ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]))
  const itemsBy = new Map<string, { item_name: string; qty: number; price_excl_gst: number | null }[]>()
  for (const it of (items ?? []) as { vendor_request_id: string; item_name: string; qty: number; price_excl_gst: number | null }[]) {
    const list = itemsBy.get(it.vendor_request_id) ?? []
    list.push({ item_name: it.item_name, qty: Number(it.qty), price_excl_gst: it.price_excl_gst === null ? null : Number(it.price_excl_gst) })
    itemsBy.set(it.vendor_request_id, list)
  }

  return rows.map((r) => {
    const req = reqById.get(r.request_id)
    const requester = req ? profById.get(req.requester_id) : undefined
    const tech = req?.assigned_to ? profById.get(req.assigned_to) : undefined
    const store = requester?.store_id ? storeById.get(requester.store_id) : undefined
    const lines = itemsBy.get(r.id) ?? []
    return {
      id: r.id, po_number: r.po_number, po_date: r.po_date, status: r.status, version: r.version, request_id: r.request_id, request_no: req?.request_no ?? '',
      store_code: store?.code ?? null, store_name: store?.name ?? null,
      vendor_name: (tech?.vendor_company_id && companyById.get(tech.vendor_company_id)) || tech?.full_name || '—',
      technician: tech?.full_name ?? null,
      items: lines.map((l) => `${l.item_name} x ${l.qty}`).join('; '),
      total: totalOf(lines),
      requested_at: r.created_at, decided_at: r.decided_at, decision_reason: r.decision_reason,
    }
  })
}

export type PoFilters = { q?: string; status?: string; from?: string; to?: string }

/** The register shows real POs by default (the approved quote of each ticket); "all" or a status shows the quotes that were waiting, revised, replaced or rejected too. */
export const DEFAULT_PO_STATUS = 'approved'

/** Search and filter the register (the same rules for the screen and the download). `from` / `to` are yyyy-mm-dd and apply to the PO date, or the request date while there is no PO date yet. */
export function filterPoRows(rows: PoRegisterRow[], f: PoFilters): PoRegisterRow[] {
  const q = (f.q ?? '').trim().toLowerCase()
  return rows.filter((r) => {
    const want = f.status === undefined || f.status === '' ? DEFAULT_PO_STATUS : f.status
    if (want !== 'all' && r.status !== want) return false
    const day = (r.po_date ?? r.requested_at).slice(0, 10)
    if (f.from && day < f.from) return false
    if (f.to && day > f.to) return false
    if (!q) return true
    return [r.po_number, r.request_no, r.store_code, r.store_name, r.vendor_name, r.technician, r.items].some((v) => (v ?? '').toLowerCase().includes(q))
  })
}

export const PO_COLUMNS = [
  { key: 'po_number', label: 'PO number', width: 18 }, { key: 'po_date', label: 'PO date', width: 12 }, { key: 'status', label: 'Status', width: 24 }, { key: 'version', label: 'Quote version', width: 14 },
  { key: 'request_no', label: 'Ticket', width: 14 }, { key: 'store', label: 'Store', width: 28 }, { key: 'vendor_name', label: 'Vendor', width: 18 }, { key: 'technician', label: 'Vendor technician', width: 22 },
  { key: 'items', label: 'Items', width: 50 }, { key: 'total', label: 'Amount (without GST)', width: 20 }, { key: 'requested_at', label: 'Requested on', width: 18 }, { key: 'decided_at', label: 'Decided on', width: 18 }, { key: 'decision_reason', label: 'Reason', width: 30 },
] as const

export async function buildPoWorkbook(rows: PoRegisterRow[], title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CityKart Desk'
  wb.created = new Date()
  const sheet = wb.addWorksheet('Purchase orders', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = PO_COLUMNS.map((c) => ({ header: c.label, key: c.key, width: c.width }))
  const head = sheet.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } }
  for (const r of rows) {
    // every cell is written as text or a number (never as a formula), so nothing typed by a person can run as one in Excel
    sheet.addRow({
      po_number: r.po_number ?? '', po_date: r.po_date ?? '', status: PO_STATUS_LABELS[r.status], version: r.version, request_no: r.request_no,
      store: r.store_name ? `${r.store_name} (${r.store_code ?? ''})` : '', vendor_name: r.vendor_name, technician: r.technician ?? '', items: r.items,
      total: r.total, requested_at: r.requested_at.slice(0, 16).replace('T', ' '), decided_at: (r.decided_at ?? '').slice(0, 16).replace('T', ' '), decision_reason: r.decision_reason ?? '',
    })
  }
  sheet.getColumn('total').numFmt = '#,##0.00'
  sheet.getCell('A' + (rows.length + 3)).value = title
  return Buffer.from(await wb.xlsx.writeBuffer())
}
