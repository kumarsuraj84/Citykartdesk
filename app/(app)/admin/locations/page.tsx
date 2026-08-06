export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { LocationsClient } from './LocationsClient'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type LocationRow = {
  id: string
  name: string
  code: string | null
  city: string | null
  country: string | null
  timezone: string
  is_active: boolean
  created_at: string
}

export type LocationStat = LocationRow & {
  user_count: number
  open_requests: number
  total_requests: number
  avg_resolution_hours: number | null
}

export default async function LocationsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  const admin = createAdminClient() as unknown as AnyClient
  const orgId = profile.org_id ?? ''

  // Fetch locations + per-location stats in parallel
  // Requests are linked to location via the requester's profile.location_id
  const [locRes, profilesRes, requestsRes] = await Promise.all([
    admin.from('locations').select('id, name, code, city, country, timezone, is_active, created_at').eq('org_id', orgId).order('name'),
    admin.from('profiles').select('id, full_name, location_id').eq('org_id', orgId).eq('is_active', true),
    admin.from('requests').select('id, requester_id, status, created_at, resolved_at').eq('org_id', orgId),
  ])

  const locations: LocationRow[] = (locRes.data ?? []).map((l: any) => ({
    id: l.id,
    name: l.name,
    code: l.code,
    city: l.city,
    country: l.country,
    timezone: l.timezone ?? 'UTC',
    is_active: l.is_active,
    created_at: l.created_at,
  }))

  const profiles: { id: string; full_name: string; location_id: string | null }[] = profilesRes.data ?? []
  const requests: { id: string; requester_id: string; status: string; created_at: string; resolved_at: string | null }[] = requestsRes.data ?? []

  // Map requester_id → location_id
  const profileLocMap = new Map(profiles.map(p => [p.id, p.location_id]))

  // Compute per-location stats
  const locationStats: LocationStat[] = locations.map((loc) => {
    const locProfiles = profiles.filter((p) => p.location_id === loc.id)
    const locRequests = requests.filter((r) => profileLocMap.get(r.requester_id) === loc.id)
    const openRequests = locRequests.filter((r) => !['resolved', 'closed', 'cancelled'].includes(r.status))

    const resolvedWithTime = locRequests.filter((r) => r.resolved_at && r.created_at)
    const avgHours =
      resolvedWithTime.length > 0
        ? resolvedWithTime.reduce((sum, r) => {
            const ms = new Date(r.resolved_at!).getTime() - new Date(r.created_at).getTime()
            return sum + ms / 3_600_000
          }, 0) / resolvedWithTime.length
        : null

    return {
      ...loc,
      user_count: locProfiles.length,
      open_requests: openRequests.length,
      total_requests: locRequests.length,
      avg_resolution_hours: avgHours !== null ? Math.round(avgHours * 10) / 10 : null,
    }
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Locations & Sites"
        description="Manage office locations and view location-wise analytics."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Locations' }]}
      />
      <LocationsClient locations={locationStats} />
    </div>
  )
}
