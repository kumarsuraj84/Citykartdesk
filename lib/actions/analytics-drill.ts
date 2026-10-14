'use server'

import { getCurrentProfile } from '@/lib/queries/profiles'
import { loadExecutiveData } from '@/lib/queries/executive-dashboard'
import type { ExecApproval, ExecTicket } from '@/lib/reporting/executive/engine'

export interface DrillData {
  now: number
  tickets: ExecTicket[]
  approvals: ExecApproval[]
  truncated: boolean
}

/**
 * The ticket rows the Smart Dashboard's pop-up works from, for the normal Dashboards page: loaded the first time a number is clicked, not with
 * the page. It is the same load (same visibility rules for the signed-in person) the Smart Dashboard itself uses, so a click on either page opens on
 * the same tickets. It is read fresh, not from the one-minute store, so the tickets in the pop-up are the same as the ones the page's numbers were counted from.
 */
export async function loadDrillData(): Promise<DrillData | { error: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Please sign in again.' }
  const data = await loadExecutiveData(profile, { fresh: true })
  if ('error' in data) return { error: data.error }
  return { now: data.now, tickets: data.tickets, approvals: data.approvals, truncated: data.truncated }
}
