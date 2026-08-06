import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

function getSecret() {
  return process.env.OWNER_PORTAL_SECRET ?? 'changeme-set-OWNER_PORTAL_SECRET-in-env'
}

async function requireOwner(): Promise<boolean> {
  const cookieStore = await cookies()
  const token = cookieStore.get('owner_token')
  return token?.value === getSecret()
}

// GET /api/owner/errors
export async function GET() {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('error_reports')
    .select('id, app, error_type, message, status, created_at, org_id, url, organizations(name)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const rows = (data ?? []).map((r) => ({
    ...r,
    org_name: (r.organizations as { name: string } | null)?.name ?? null,
    organizations: undefined,
  }))

  return NextResponse.json(rows)
}

// PATCH /api/owner/errors  { id, status }
export async function PATCH(req: NextRequest) {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { id, status } = await req.json()

  const { error } = await admin.from('error_reports').update({ status }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
