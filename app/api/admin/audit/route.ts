import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getAuditLogs } from '@/lib/queries/admin'

export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  // The query reads page x perPage rows from each of three tables, so the page number is bounded (an unbounded page asked for billions of rows). G-31.
  const MAX_PAGE = 100
  const page = Math.min(MAX_PAGE, Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1))
  const perPage = Math.min(200, Math.max(1, parseInt(searchParams.get('perPage') ?? '50', 10) || 50))
  const actorId = searchParams.get('actorId') ?? undefined
  const entityTypeParam = searchParams.get('entityType') ?? 'all'
  const entityType = (
    ['request', 'task', 'catalog', 'all'].includes(entityTypeParam) ? entityTypeParam : 'all'
  ) as 'request' | 'task' | 'catalog' | 'all'
  const dateFrom = searchParams.get('dateFrom') ?? undefined
  const dateTo = searchParams.get('dateTo') ?? undefined
  if ((dateFrom && Number.isNaN(Date.parse(dateFrom))) || (dateTo && Number.isNaN(Date.parse(dateTo)))) {
    return NextResponse.json({ error: 'dateFrom / dateTo must be dates' }, { status: 400 })
  }

  // A failed read is an error answer, not an empty log: an empty list would look like "nothing happened".
  try {
    const result = await getAuditLogs({ page, perPage, actorId, entityType, dateFrom, dateTo })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[admin/audit] query failed', e)
    return NextResponse.json({ error: 'The audit log could not be read. Please try again.' }, { status: 500 })
  }
}
