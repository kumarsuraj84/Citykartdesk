import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { toCSV } from '@/lib/export/csv'
import { exportAllowed, auditExportEvent, EXPORT_LIMIT_MESSAGE } from '@/lib/security/export-guard'
import { AC_COLUMNS, GENSET_COLUMNS, exportRows, filterFleet, isFleetKind, loadFleet, type AcMasterRow, type FleetFilters, type GensetMasterRow } from '@/lib/masters/fleet'

// Download of the AC master / Genset master (the screen's filters apply). Administrators and managers only; the server reads the tables, nothing is public.
export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile || !profile.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'platform_owner', 'manager'].includes(profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sp = req.nextUrl.searchParams
  const kind = sp.get('kind')
  if (!isFleetKind(kind)) return NextResponse.json({ error: 'Unknown master' }, { status: 400 })
  // limited per person per hour (counted in the database) and recorded in the audit trail with the filters, never the contents
  if (!(await exportAllowed(profile.id, `master_${kind}`))) return NextResponse.json({ error: EXPORT_LIMIT_MESSAGE }, { status: 429 })
  const status = (['active', 'inactive', 'removed', 'all'] as const).find((s) => s === sp.get('status')) ?? 'active'
  const filters: FleetFilters = { q: sp.get('q') ?? undefined, status, brand: sp.get('brand') ?? undefined, region: sp.get('region') ?? undefined, vendor: sp.get('vendor') ?? undefined }
  const db = createAdminClient() as unknown as { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
  const all: (AcMasterRow | GensetMasterRow)[] = kind === 'ac' ? await loadFleet(db, profile.org_id, 'ac') : await loadFleet(db, profile.org_id, 'genset')
  const shown = filterFleet(all, filters)
  await auditExportEvent(profile, `master_${kind}`, shown.length, filters)
  const csv = toCSV(exportRows(kind, shown), kind === 'ac' ? AC_COLUMNS : GENSET_COLUMNS)
  return new NextResponse('﻿' + csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${kind}-master-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' },
  })
}
