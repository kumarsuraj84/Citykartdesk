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

// GET /api/owner/organizations/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  const [orgRes, usersRes, snapshotsRes, modulesRes, licenseRes] = await Promise.all([
    admin.from('organizations').select('*').eq('id', id).single(),
    admin.from('profiles').select('id, full_name, email, role, job_title, is_active, created_at').eq('org_id', id).order('created_at'),
    admin.from('billing_snapshots').select('*').eq('org_id', id).order('snapshot_month', { ascending: false }).limit(24),
    admin.from('org_module_access').select('*').eq('org_id', id),
    admin.from('license_keys').select('id, key_hash, issued_at, expires_at, revoked_at').eq('org_id', id).order('issued_at', { ascending: false }),
  ])

  if (orgRes.error) return NextResponse.json({ error: orgRes.error.message }, { status: 400 })

  // Count users
  const { count: userCount } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('org_id', id)
  const { count: activeCount } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('org_id', id).eq('is_active', true)

  return NextResponse.json({
    org:       { ...orgRes.data, user_count: userCount ?? 0, active_user_count: activeCount ?? 0 },
    users:     usersRes.data ?? [],
    snapshots: snapshotsRes.data ?? [],
    modules:   modulesRes.data ?? [],
    licenses:  licenseRes.data ?? [],
  })
}

// PATCH /api/owner/organizations/[id]  { field updates }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const admin = createAdminClient()

  const { error } = await admin.from('organizations').update(body).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/owner/organizations/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const admin = createAdminClient()

  const { data, error } = await admin.rpc('owner_delete_org', { p_org_id: id })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const result = data as { ok: boolean; error?: string; deleted?: string }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true, deleted: result.deleted })
}
