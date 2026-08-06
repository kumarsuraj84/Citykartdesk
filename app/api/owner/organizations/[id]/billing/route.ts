import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'

async function requireOwner() {
  const secret = process.env.OWNER_PORTAL_SECRET ?? 'changeme-set-OWNER_PORTAL_SECRET-in-env'
  const cookieStore = await cookies()
  return cookieStore.get('owner_token')?.value === secret
}

// PATCH /api/owner/organizations/[id]/billing  — update billing fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { billing_email, per_employee_rate, plan } = await req.json()
  const admin = createAdminClient()

  const update: Record<string, unknown> = {}
  if (billing_email   !== undefined) update.billing_email    = billing_email
  if (per_employee_rate !== undefined) update.per_employee_rate = per_employee_rate
  if (plan            !== undefined) update.plan             = plan

  const { error } = await admin.from('organizations').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}

// POST /api/owner/organizations/[id]/billing  — upsert billing snapshot
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireOwner()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: org_id } = await params
  const body = await req.json()
  const admin = createAdminClient()

  const { error } = await admin.from('billing_snapshots').upsert({
    org_id,
    snapshot_month:  body.month,
    user_count:      body.user_count,
    per_seat_rate:   body.per_seat_rate,
    amount_due:      body.amount_due,
    plan:            body.plan,
    notes:           body.notes ?? null,
  }, { onConflict: 'org_id,snapshot_month' })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
