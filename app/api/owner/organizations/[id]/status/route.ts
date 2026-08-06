import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

async function requireOwner() {
  const secret = process.env.OWNER_PORTAL_SECRET ?? 'changeme-set-OWNER_PORTAL_SECRET-in-env'
  const cookieStore = await cookies()
  return cookieStore.get('owner_token')?.value === secret
}

// PATCH /api/owner/organizations/[id]/status  { status: 'active'|'suspended'|'cancelled'|'trial' }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { status } = await req.json()
  const admin = createAdminClient()

  const { error } = await admin.from('organizations').update({ status }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
