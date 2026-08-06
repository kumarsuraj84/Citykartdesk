import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'
import { randomBytes } from 'crypto'

function getSecret() {
  return process.env.OWNER_PORTAL_SECRET ?? 'changeme-set-OWNER_PORTAL_SECRET-in-env'
}

async function requireOwner(): Promise<boolean> {
  const cookieStore = await cookies()
  const token = cookieStore.get('owner_token')
  return token?.value === getSecret()
}

// GET /api/owner/licensing  — returns modules + license keys with org names
export async function GET() {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const [modulesRes, licensesRes] = await Promise.all([
    admin
      .from('org_module_access')
      .select('id, org_id, module, enabled, valid_until, organizations(name)')
      .order('org_id'),
    admin
      .from('license_keys')
      .select('id, org_id, key_hash, issued_at, expires_at, revoked_at, organizations(name)')
      .order('issued_at', { ascending: false }),
  ])

  const modules = (modulesRes.data ?? []).map((r) => ({
    id:         r.id,
    org_id:     r.org_id,
    org_name:   (r.organizations as { name: string } | null)?.name ?? r.org_id,
    module:     r.module,
    enabled:    r.enabled,
    valid_until: r.valid_until,
  }))

  const licenses = (licensesRes.data ?? []).map((r) => ({
    id:         r.id,
    org_id:     r.org_id,
    org_name:   (r.organizations as { name: string } | null)?.name ?? r.org_id,
    key_hash:   r.key_hash,
    issued_at:  r.issued_at,
    expires_at: r.expires_at,
    revoked_at: r.revoked_at,
  }))

  return NextResponse.json({ modules, licenses })
}

// PATCH /api/owner/licensing  { action, ... }
export async function PATCH(req: NextRequest) {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const body = await req.json()

  // Toggle module enabled
  if (body.action === 'toggle_module') {
    const { error } = await admin
      .from('org_module_access')
      .update({ enabled: body.enabled })
      .eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  // Issue license key
  if (body.action === 'issue_license') {
    const { org_id, months } = body
    const issuedAt  = new Date()
    const expiresAt = new Date(issuedAt)
    expiresAt.setMonth(expiresAt.getMonth() + (months ?? 12))

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

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
