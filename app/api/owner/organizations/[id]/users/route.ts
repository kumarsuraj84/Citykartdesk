import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

async function requireOwner() {
  const secret = process.env.OWNER_PORTAL_SECRET ?? 'changeme-set-OWNER_PORTAL_SECRET-in-env'
  const cookieStore = await cookies()
  return cookieStore.get('owner_token')?.value === secret
}

// POST /api/owner/organizations/[id]/users  — create a user in this org
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: org_id } = await params
  const { name, email, password, role } = await req.json()
  const admin = createAdminClient()

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role },
  })
  if (userError) return NextResponse.json({ error: userError.message }, { status: 400 })

  const { error: profileError } = await admin.from('profiles').insert({
    id: userData.user.id,
    org_id,
    email,
    full_name: name,
    role: role ?? 'agent',
  })
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}

// PATCH /api/owner/organizations/[id]/users  — toggle active or reset password
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  await params  // ensure segment is loaded

  const { user_id, action, is_active, new_password } = await req.json()

  if (action === 'toggle') {
    const { error } = await admin.from('profiles').update({ is_active }).eq('id', user_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'reset_password') {
    const { error } = await admin.auth.admin.updateUserById(user_id, { password: new_password })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
