import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getAuditLogs } from '@/lib/queries/admin'

export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'manager', 'platform_owner'].includes(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const perPage = parseInt(searchParams.get('perPage') ?? '50', 10)
  const actorId = searchParams.get('actorId') ?? undefined
  const entityTypeParam = searchParams.get('entityType') ?? 'all'
  const entityType = (
    ['request', 'task', 'catalog', 'all'].includes(entityTypeParam) ? entityTypeParam : 'all'
  ) as 'request' | 'task' | 'catalog' | 'all'
  const dateFrom = searchParams.get('dateFrom') ?? undefined
  const dateTo = searchParams.get('dateTo') ?? undefined

  const result = await getAuditLogs({ page, perPage, actorId, entityType, dateFrom, dateTo })
  return NextResponse.json(result)
}
