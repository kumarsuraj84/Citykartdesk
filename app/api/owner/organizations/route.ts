import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GET /api/owner/organizations - list all organizations
// POST /api/owner/organizations - create a new organization (admin operation)

export async function GET() {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('organizations')
      .select('id, name, slug, status, seat_limit, trial_ends_at, created_at')

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    // Count users per org
    const orgsWithCounts = await Promise.all(
      (data ?? []).map(async (org) => {
        const { count } = await admin
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', org.id)
        return { ...org, user_count: count ?? 0 }
      })
    )

    return NextResponse.json(orgsWithCounts)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch organizations' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    name,
    slug,
    seat_limit,
    billing_email,
    per_employee_rate,
    plan,
    country,
    admin_name,
    admin_email,
    admin_password,
  } = body

  if (!name || !slug) {
    return NextResponse.json(
      { error: 'name and slug required' },
      { status: 400 }
    )
  }

  try {
    // Use admin client to create organization (service-role bypasses RLS)
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('organizations')
      .insert({
        name,
        slug,
        status: 'active',
        seat_limit: seat_limit || 10,
        billing_email: billing_email || null,
        per_employee_rate: per_employee_rate || null,
        plan: plan || 'standard',
        country: country || null,
      })
      .select('id, name, slug, status, seat_limit, created_at')
      .single()

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    // If admin credentials provided, create initial admin user
    if (admin_email && admin_password && data) {
      try {
        const { data: userData, error: userError } = await admin.auth.admin.createUser({
          email: admin_email,
          password: admin_password,
          user_metadata: {
            name: admin_name || '',
            role: 'admin',
          },
        })

        if (userError) {
          console.error('Failed to create admin user:', userError)
          // Don't fail the org creation if user creation fails
        } else if (userData) {
          // Create profile for the user
          await admin.from('profiles').insert({
            id: userData.user.id,
            org_id: data.id,
            email: admin_email,
            name: admin_name || '',
            role: 'admin',
          }).single()
        }
      } catch (err) {
        console.error('Error creating admin user:', err)
        // Don't fail the org creation if user creation fails
      }
    }

    return NextResponse.json({ ok: true, data })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Creation failed' },
      { status: 500 }
    )
  }
}
