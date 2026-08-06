import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'

async function requireOwner() {
  const secret = process.env.OWNER_PORTAL_SECRET ?? 'changeme-set-OWNER_PORTAL_SECRET-in-env'
  const cookieStore = await cookies()
  return cookieStore.get('owner_token')?.value === secret
}

// POST /api/owner/organizations/[id]/licenses  { months: number }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: org_id } = await params
  const { months = 12 } = await req.json()
  const admin = createAdminClient()

  const issuedAt  = new Date()
  const expiresAt = new Date(issuedAt)
  expiresAt.setMonth(expiresAt.getMonth() + months)

  const keyRaw  = randomBytes(32).toString('hex')
  const keyHash = `LK-${keyRaw.slice(0, 8).toUpperCase()}-${keyRaw.slice(8, 12).toUpperCase()}`

  const { error } = await admin.from('license_keys').insert({
    org_id,
    key_hash:   keyHash,
    issued_at:  issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true, key_hint: keyHash })
}
