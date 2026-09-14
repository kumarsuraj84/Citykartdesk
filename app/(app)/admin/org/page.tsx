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
  user_count: number
  open_requests: number
  total_requests: number
  avg_resolution_hours: number | null
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

export interface JobFunctionRow {
  id: string
  name: string
  code: string | null
  is_active: boolean
  created_at: string
}

export interface DesignationRow {
  id: string
  name: string
  code: string | null
  is_active: boolean
  created_at: string
}

export interface UserOption {
  id: string
  full_name: string
}

export interface OemRow {
  id: string
  name: string
  emails: string[]
  email_subject_template: string | null
  email_body_template: string | null
  is_active: boolean
  created_at: string
}

export interface StoreRow {
  id: string
  code: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  pincode: string | null
  oem_id: string | null
  oem_name?: string | null
  is_active: boolean
  created_at: string
}

export default async function OrgStructurePage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any

  const [deptResult, locResult, ccResult, funcResult, desigResult, usersResult, allProfilesResult, requestsResult, oemResult, storeResult] = await Promise.all([
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
      .from('job_functions')
      .select('id, name, code, is_active, created_at')
      .order('name'),
    supabase
      .from('designations')
      .select('id, name, code, is_active, created_at')
      .order('name'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('profiles')
      .select('id, location_id')
      .eq('org_id', profile.org_id ?? '')
      .eq('is_active', true),
    supabase
      .from('requests')
      .select('id, requester_id, status, created_at, resolved_at')
      .eq('org_id', profile.org_id ?? ''),
    supabase
      .from('oems')
      .select('id, name, emails, email_subject_template, email_body_template, is_active, created_at')
      .order('name'),
    supabase
      .from('stores')
      .select('id, code, name, address, city, state, pincode, oem_id, is_active, created_at, oem:oems(name)')
      .order('code'),
  ])

  type DeptQueryRow = {
    id: string; name: string; code: string | null; parent_id: string | null
    head_user_id: string | null; is_active: boolean; created_at: string
    head: { full_name: string } | null
  }
  type LocQueryRow = {
    id: string; name: string; code: string | null; city: string | null; country: string | null
    timezone: string | null; is_active: boolean; created_at: string
  }
  type CCQueryRow = {
    id: string; name: string; code: string | null; department_id: string | null
    is_active: boolean; created_at: string
    department: { name: string } | null
  }
  type ProfileQueryRow = { id: string; full_name: string }

  const departments: DepartmentRow[] = ((deptResult.data ?? []) as DeptQueryRow[]).map((d) => ({
    id: d.id,
    name: d.name,
    code: d.code,
    parent_id: d.parent_id,
    head_user_id: d.head_user_id,
    head_name: d.head?.full_name ?? null,
    is_active: d.is_active,
    created_at: d.created_at,
  }))

  const locProfiles: { id: string; location_id: string | null }[] = allProfilesResult.data ?? []
  const locRequests: { id: string; requester_id: string; status: string; created_at: string; resolved_at: string | null }[] = requestsResult.data ?? []
  const profileLocMap = new Map(locProfiles.map((p) => [p.id, p.location_id]))

  const locations: LocationRow[] = ((locResult.data ?? []) as LocQueryRow[]).map((l) => {
    const usersHere = locProfiles.filter((p) => p.location_id === l.id)
    const requestsHere = locRequests.filter((r) => profileLocMap.get(r.requester_id) === l.id)
    const openRequests = requestsHere.filter((r) => !['resolved', 'closed', 'cancelled'].includes(r.status))
    const resolvedWithTime = requestsHere.filter((r) => r.resolved_at && r.created_at)
    const avgHours =
      resolvedWithTime.length > 0
        ? resolvedWithTime.reduce((sum, r) => sum + (new Date(r.resolved_at!).getTime() - new Date(r.created_at).getTime()) / 3_600_000, 0) / resolvedWithTime.length
        : null

    return {
      id: l.id,
      name: l.name,
      code: l.code,
      city: l.city,
      country: l.country,
      timezone: l.timezone ?? 'UTC',
      is_active: l.is_active,
      created_at: l.created_at,
      user_count: usersHere.length,
      open_requests: openRequests.length,
      total_requests: requestsHere.length,
      avg_resolution_hours: avgHours !== null ? Math.round(avgHours * 10) / 10 : null,
    }
  })

  const costCenters: CostCenterRow[] = ((ccResult.data ?? []) as CCQueryRow[]).map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    department_id: c.department_id,
    department_name: c.department?.name ?? null,
    is_active: c.is_active,
    created_at: c.created_at,
  }))

  const allUsers: UserOption[] = ((usersResult.data ?? []) as ProfileQueryRow[]).map((p) => ({
    id: p.id,
    full_name: p.full_name,
  }))

  const jobFunctions: JobFunctionRow[] = funcResult.data ?? []
  const designations: DesignationRow[] = desigResult.data ?? []

  const oems: OemRow[] = oemResult.data ?? []

  type StoreQueryRow = {
    id: string; code: string; name: string; address: string | null; city: string | null
    state: string | null; pincode: string | null; oem_id: string | null
    is_active: boolean; created_at: string; oem: { name: string } | null
  }
  const stores: StoreRow[] = ((storeResult.data ?? []) as StoreQueryRow[]).map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    address: s.address,
    city: s.city,
    state: s.state,
    pincode: s.pincode,
    oem_id: s.oem_id,
    oem_name: s.oem?.name ?? null,
    is_active: s.is_active,
    created_at: s.created_at,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization Structure"
        description="Manage departments, locations, cost centers, functions, and designations."
      />
      <OrgStructureClient
        departments={departments}
        locations={locations}
        costCenters={costCenters}
        jobFunctions={jobFunctions}
        designations={designations}
        allUsers={allUsers}
        oems={oems}
        stores={stores}
      />
    </div>
  )
}
