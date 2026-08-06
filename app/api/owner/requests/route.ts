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

// GET /api/owner/requests
export async function GET() {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('signup_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data ?? [])
}

// PATCH /api/owner/requests  { id, action: 'approve'|'reject', org_name?, seat_limit?, rejection_reason? }
export async function PATCH(req: NextRequest) {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { id, action, org_name, seat_limit, rejection_reason } = await req.json()

  if (action === 'approve') {
    const { data: reqData, error: fetchErr } = await admin
      .from('signup_requests')
      .select('*')
      .eq('id', id)
      .single()
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 400 })

    // Create the organization
    const slug = (org_name as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const { data: org, error: orgErr } = await admin
      .from('organizations')
      .insert({
        name: org_name,
        slug,
        status: 'trial',
        seat_limit: seat_limit ?? 10,
        billing_email: reqData?.email ?? null,
      })
      .select('id')
      .single()

    if (orgErr) return NextResponse.json({ error: orgErr.message }, { status: 400 })

    // Create the admin user
    const { data: userData } = await admin.auth.admin.createUser({
      email: reqData.email,
      password: Math.random().toString(36).slice(2, 10) + 'Ax1!',
      email_confirm: true,
      user_metadata: { name: reqData.full_name, role: 'admin' },
    })

    if (userData?.user && org) {
      await admin.from('profiles').insert({
        id: userData.user.id,
        org_id: org.id,
        email: reqData.email,
        full_name: reqData.full_name,
        role: 'admin',
      })
    }

    // Mark request approved
    await admin.from('signup_requests').update({ status: 'approved' }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'reject') {
    const { error } = await admin
      .from('signup_requests')
      .update({ status: 'rejected', rejection_reason: rejection_reason ?? '' })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
