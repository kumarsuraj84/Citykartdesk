import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

async function requireOwner() {
  const secret = process.env.OWNER_PORTAL_SECRET ?? 'changeme-set-OWNER_PORTAL_SECRET-in-env'
  const cookieStore = await cookies()
  return cookieStore.get('owner_token')?.value === secret
}

// PATCH /api/owner/organizations/[id]/modules  { module_id, enabled }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await params  // load segment

  const { module_id, enabled } = await req.json()
  const admin = createAdminClient()

  const { error } = await admin
    .from('org_module_access')
    .update({ enabled })
    .eq('id', module_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
