'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { diagnoseTickets, type AutomationDiagnosis, type Db } from '@/lib/automation/diagnose'
import { rerunAutomation, type RerunResult } from '@/lib/automation/rerun'

// "Run automation again" and the Stuck tickets list: ONLY administrators and platform owners (nobody else sees the button or the list, and the server checks it again here).

async function ownerTier() {
  const profile = await getCurrentProfile()
  if (!profile || (profile.role !== 'admin' && profile.role !== 'platform_owner')) return null
  return profile
}

/** The ticket's automation steps, for the panel on the ticket. null for anyone who may not see it, or a ticket of another organisation. */
export async function getTicketAutomation(requestId: string): Promise<AutomationDiagnosis | null> {
  const profile = await ownerTier()
  if (!profile) return null
  const db = createAdminClient() as unknown as Db
  const { data: r } = await db.from('requests').select('org_id').eq('id', requestId).maybeSingle()
  if (!r || r.org_id !== profile.org_id) return null
  return (await diagnoseTickets(db, [requestId]))[0] ?? null
}

/** The "Run automation again" button: runs only what is missing on this ticket. */
export async function runTicketAutomationAgain(requestId: string): Promise<RerunResult> {
  const profile = await ownerTier()
  if (!profile) return { ok: false, error: 'Only an administrator or platform owner can do this.', message: 'Only an administrator or platform owner can do this.', outcomes: [] }
  const db = createAdminClient() as unknown as Db
  const { data: r } = await db.from('requests').select('org_id').eq('id', requestId).maybeSingle()
  if (!r || r.org_id !== profile.org_id) return { ok: false, error: 'Ticket not found.', message: 'Ticket not found.', outcomes: [] }
  const result = await rerunAutomation({ requestId, mode: 'manual', actor: { id: profile.id, name: profile.full_name } })
  revalidatePath(`/requests/${requestId}`)
  revalidatePath('/admin/stuck-tickets')
  return result
}
