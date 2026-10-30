import ExcelJS from 'exceljs'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { totalOf } from './lines'
import { fetchAllPages } from '@/lib/queries/paging'
import { inBatches } from '@/lib/queries/in-batches'

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

/**
 * The most POs one register shows (newest first). Every list of ids sent to the database is read in batches of 100 (IN_BATCH): the production proxy refuses a request line of
 * about 16 KB, which is roughly 400 ids, so one `.in()` with thousands of ids failed and the register came back empty.
 */
const MAX_ROWS = 5000

type VrRow = { id: string; status: PoRegisterRow['status']; version: number; request_id: string; po_number: string | null; po_date: string | null; created_by: string | null; created_at: string; decided_at: string | null; decision_reason: string | null; org_id: string }
const VR_COLUMNS = 'id, status, version, request_id, po_number, po_date, created_by, created_at, decided_at, decision_reason, org_id'

/** A batched read that throws on a failed batch (the register must say "could not load", not show fewer POs). */
async function readIn<T>(ids: string[], what: string, run: (batch: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  if (ids.length === 0) return []
  const res = await inBatches<T>(ids, run)
  if (res.error) throw new Error(`PO register: could not read ${what}: ${res.error.message}`)
  return res.data
}

export async function loadPoRegister(viewer: Viewer): Promise<PoRegisterRow[]> {
  const admin = createAdminClient() as unknown as Db
  let rows: VrRow[]
  if (viewer.kind === 'staff') {
    const { rows: all } = await fetchAllPages<VrRow>((from, to) => admin.from('vendor_requests').select(VR_COLUMNS).eq('kind', 'po').eq('org_id', viewer.orgId).order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to), { maxRows: MAX_ROWS })
    rows = all
  } else {
    // a vendor reads the POs of the tickets row security lets him read (his own, or his company's for a manager)
    const supabase = await createClient()
    const { rows: visible } = await fetchAllPages<{ id: string }>((from, to) => supabase.from('requests').select('id').order('id', { ascending: true }).range(from, to), { maxRows: MAX_ROWS })
    const ids = visible.map((r) => r.id)
    if (ids.length === 0) return []
    rows = (await readIn<VrRow>(ids, 'the purchase orders', (b) => admin.from('vendor_requests').select(VR_COLUMNS).eq('kind', 'po').in('request_id', b)))
      .sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0)).slice(0, MAX_ROWS)
  }
  if (rows.length === 0) return []

  const requestIds = [...new Set(rows.map((r) => r.request_id))]
  const [reqs, items] = await Promise.all([
    readIn<{ id: string; request_no: string; requester_id: string; assigned_to: string | null }>(requestIds, 'the tickets', (b) => admin.from('requests').select('id, request_no, requester_id, assigned_to').in('id', b)),
    readIn<{ vendor_request_id: string; line_no: number; item_name: string; qty: number; price_excl_gst: number | null }>(rows.map((r) => r.id), 'the items', (b) => admin.from('vendor_request_items').select('vendor_request_id, line_no, item_name, qty, price_excl_gst').in('vendor_request_id', b).order('line_no', { ascending: true })),
  ])
  const reqById = new Map(reqs.map((r) => [r.id, r]))
  const people = [...new Set([...reqById.values()].flatMap((r) => [r.requester_id, r.assigned_to]).filter((v): v is string => !!v))]
  const profs = await readIn<{ id: string; full_name: string; store_id: string | null; vendor_company_id: string | null }>(people, 'the people', (b) => admin.from('profiles').select('id, full_name, store_id, vendor_company_id').in('id', b))
  const profById = new Map(profs.map((p) => [p.id, p]))
  const storeIds = [...new Set([...profById.values()].map((p) => p.store_id).filter((v): v is string => !!v))]
  const companyIds = [...new Set([...profById.values()].map((p) => p.vendor_company_id).filter((v): v is string => !!v))]
  const [stores, companies] = await Promise.all([
    readIn<{ id: string; code: string; name: string }>(storeIds, 'the stores', (b) => admin.from('stores').select('id, code, name').in('id', b)),
    readIn<{ id: string; name: string }>(companyIds, 'the vendor companies', (b) => admin.from('vendor_companies').select('id, name').in('id', b)),
  ])
  const storeById = new Map(stores.map((s) => [s.id, s]))
  const companyById = new Map(companies.map((c) => [c.id, c.name]))
  const itemsBy = new Map<string, { item_name: string; qty: number; price_excl_gst: number | null }[]>()
  for (const it of items) {
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
