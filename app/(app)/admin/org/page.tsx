import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { PageHeader } from '@/components/ui/PageHeader'
import { OrgStructureClient } from './OrgStructureClient'

export const dynamic = 'force-dynamic'

export interface DepartmentRow {
  id: string
  name: string
  code: string | null
  parent_id: string | null
  head_user_id: string | null
  head_name?: string | null
  is_active: boolean
  created_at: string
}

export interface LocationRow {
  id: string
  name: string
  code: string | null
  city: string | null
  country: string | null
  timezone: string
  is_active: boolean
  created_at: string
}

export interface CostCenterRow {
  id: string
  name: string
  code: string | null
  department_id: string | null
  department_name?: string | null
  is_active: boolean
  created_at: string
}

export interface UserOption {
  id: string
  full_name: string
}

export default async function OrgStructurePage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any

  const [deptResult, locResult, ccResult, usersResult] = await Promise.all([
    supabase
      .from('departments')
      .select('id, name, code, parent_id, head_user_id, is_active, created_at, head:profiles!departments_head_user_id_fkey(full_name)')
      .order('name'),
    supabase
      .from('locations')
      .select('id, name, code, city, country, timezone, is_active, created_at')
      .order('name'),
    supabase
      .from('cost_centers')
      .select('id, name, code, department_id, is_active, created_at, department:departments(name)')
      .order('name'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('is_active', true)
      .order('full_name'),
  ])

  const departments: DepartmentRow[] = (deptResult.data ?? []).map((d: any) => ({
    id: d.id,
    name: d.name,
    code: d.code,
    parent_id: d.parent_id,
    head_user_id: d.head_user_id,
    head_name: d.head?.full_name ?? null,
    is_active: d.is_active,
    created_at: d.created_at,
  }))

  const locations: LocationRow[] = (locResult.data ?? []).map((l: any) => ({
    id: l.id,
    name: l.name,
    code: l.code,
    city: l.city,
    country: l.country,
    timezone: l.timezone ?? 'UTC',
    is_active: l.is_active,
    created_at: l.created_at,
  }))

  const costCenters: CostCenterRow[] = (ccResult.data ?? []).map((c: any) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    department_id: c.department_id,
    department_name: c.department?.name ?? null,
    is_active: c.is_active,
    created_at: c.created_at,
  }))

  const allUsers: UserOption[] = (usersResult.data ?? []).map((p: any) => ({
    id: p.id,
    full_name: p.full_name,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Structure"
        description="Manage departments, locations, and cost centers."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Org Structure' }]}
      />
      <OrgStructureClient
        departments={departments}
        locations={locations}
        costCenters={costCenters}
        allUsers={allUsers}
      />
    </div>
  )
}
