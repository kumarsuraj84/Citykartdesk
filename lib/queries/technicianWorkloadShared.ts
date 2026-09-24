import type { RequestStatus } from '@/types'

// Client-safe home for the Technician Workload constant/type — no server-only
// imports here. lib/queries/requests.ts (server-only, pulls in next/headers
// via lib/supabase/server) also exports getTechnicianWorkloadBoard(), so any
// client component that imported ACTIVE_TECH_STATUSES/TechnicianWorkloadRow
// directly from that file dragged its entire server-only import chain into
// the browser bundle. This file exists purely so client components can get
// just the shape, not the fetcher.

/** The still-in-flight statuses a technician's workload is measured across —
 *  deliberately excludes resolved/closed/cancelled. */
export const ACTIVE_TECH_STATUSES: RequestStatus[] = ['open', 'assigned', 'in_progress', 'waiting_user', 'pending_approval']

export type TechnicianWorkloadRow = {
  /** null = the "Unassigned" row. */
  technicianId: string | null
  technicianName: string
  counts: Partial<Record<RequestStatus, number>>
  total: number
}
