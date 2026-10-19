// The open AC issues of a store, grouped by AC: what the engineer sees on the public page and what the store confirms. Read from the tickets and the saved AC details
// (request_master_snapshots), so the grouping follows the AC the requester chose, not text typed into a form.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export const OPEN_STATUSES = ['open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho'] as const

export type IssueTicket = { id: string; requestNo: string; title: string; status: string; createdAt: string; requesterId: string; assignedTo: string | null }
export type AcIssue = {
  unitId: string
  ckdeskNo: string
  details: string
  serial: string | null
  tickets: IssueTicket[]
}

type SnapshotUnit = { id?: string; ckdesk_no?: string; serial?: string | null; floor?: string | null; ac_type?: string | null; tonnage?: string | null; brand?: string | null; store_code?: string }

function describe(u: SnapshotUnit): string {
  return [u.floor, [u.ac_type, u.tonnage].filter(Boolean).join(' '), u.brand].filter(Boolean).join(', ')
}

const numericFirst = (a: string, b: string) => {
  const na = Number(a), nb = Number(b)
  return Number.isFinite(na) && Number.isFinite(nb) && na !== nb ? na - nb : a.localeCompare(b, undefined, { numeric: true })
}

/** Open tickets of the store that are about an AC, grouped by that AC. Ticket statuses that still mean work to do only. */
export async function loadOpenAcIssues(db: Db, orgId: string, storeCode: string): Promise<AcIssue[]> {
  const code = storeCode.toUpperCase()
  const { data } = await db
    .from('request_master_snapshots')
    .select('request_id, unit_ids, snapshot, requests!inner(id, request_no, title, status, created_at, requester_id, assigned_to, org_id)')
    .eq('kind', 'ac')
    .eq('requests.org_id', orgId)
    .in('requests.status', [...OPEN_STATUSES])
    .limit(2000)
  const groups = new Map<string, AcIssue>()
  for (const row of (data ?? []) as { request_id: string; unit_ids: string[]; snapshot: SnapshotUnit[]; requests: { id: string; request_no: string; title: string; status: string; created_at: string; requester_id: string; assigned_to: string | null } | { id: string; request_no: string; title: string; status: string; created_at: string; requester_id: string; assigned_to: string | null }[] }[]) {
    const unit = row.snapshot?.[0]
    if (!unit || String(unit.store_code ?? '').toUpperCase() !== code) continue
    const unitId = row.unit_ids?.[0] ?? unit.id
    if (!unitId) continue
    const req = Array.isArray(row.requests) ? row.requests[0] : row.requests
    if (!req) continue
    const g = groups.get(unitId) ?? { unitId, ckdeskNo: String(unit.ckdesk_no ?? '?'), details: describe(unit), serial: unit.serial ?? null, tickets: [] }
    g.tickets.push({ id: req.id, requestNo: req.request_no, title: req.title, status: req.status, createdAt: req.created_at, requesterId: req.requester_id, assignedTo: req.assigned_to })
    groups.set(unitId, g)
  }
  for (const g of groups.values()) g.tickets.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return [...groups.values()].sort((a, b) => numericFirst(a.ckdeskNo, b.ckdeskNo))
}
