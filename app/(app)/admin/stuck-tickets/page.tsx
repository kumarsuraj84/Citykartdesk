import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { diagnoseTickets, type AutomationDiagnosis, type Db } from '@/lib/automation/diagnose'
import { StuckTicketsClient, type StuckRow } from './StuckTicketsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Stuck tickets' }

const DAYS = 14
// how many tickets one visit checks; the page is read in pieces of PIECE so a long list is not one huge request, and it says so when there are more than LIMIT
const LIMIT = 1000
const PIECE = 200
const sinceIso = () => new Date(Date.now() - DAYS * 24 * 3600_000).toISOString()
// a ticket made BEFORE this feature (no record of its automatic steps) is listed only while it is recent: older ones were handled another way long ago
const OLDER_TICKET_DAYS = 3
const olderCutoffMs = () => Date.now() - OLDER_TICKET_DAYS * 24 * 3600_000

export default async function StuckTicketsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'platform_owner'].includes(profile.role)) redirect('/home')
  if (!profile.org_id) redirect('/home')

  const db = createAdminClient() as unknown as Db
  const since = sinceIso()
  const statuses = ['open', 'in_progress', 'waiting_user', 'pending_approval']
  const ids: string[] = []
  let total = 0
  let checkError: string | null = null
  try {
    const { count } = await db.from('requests').select('id', { count: 'exact', head: true }).eq('org_id', profile.org_id).in('status', statuses).gte('created_at', since)
    total = count ?? 0
    for (let from = 0; from < Math.min(total, LIMIT); from += PIECE) {
      const { data, error } = await db.from('requests').select('id').eq('org_id', profile.org_id).in('status', statuses)
        .gte('created_at', since).order('created_at', { ascending: false }).range(from, Math.min(from + PIECE, LIMIT) - 1)
      if (error) throw new Error(error.message)
      ids.push(...((data ?? []) as { id: string }[]).map((r) => r.id))
    }
  } catch (e) {
    console.error('[stuck-tickets] could not list the tickets', e)
    checkError = 'The tickets could not be listed just now, so this page may be incomplete. Please reload in a minute.'
  }
  const cutoff = olderCutoffMs()
  let all: AutomationDiagnosis[] = []
  try {
    for (let i = 0; i < ids.length; i += PIECE) all = all.concat(await diagnoseTickets(db, ids.slice(i, i + PIECE)))
  } catch (e) {
    // a table that cannot be read is NOT "everything is fine": say so
    console.error('[stuck-tickets] could not check the tickets', e)
    checkError = 'The tickets could not be checked just now (a table could not be read), so this page may be incomplete. Please reload in a minute.'
  }
  const diagnoses = all.filter((d) => d.tracked || new Date(d.createdAt).getTime() >= cutoff)
  const toRow = (d: AutomationDiagnosis): StuckRow => ({
    requestId: d.requestId, requestNo: d.requestNo, title: d.title, status: d.status, createdAt: d.createdAt, interrupted: d.interrupted, gaveUp: d.gaveUp, older: !d.tracked,
    missing: d.steps.filter((s) => s.state === 'missing').map((s) => ({ label: s.label, detail: s.detail })),
    blocked: d.steps.filter((s) => s.state === 'blocked').map((s) => ({ label: s.label, detail: s.detail })),
  })
  const broken = diagnoses.filter((d) => d.eligible && d.kind === 'broken').map(toRow)
  const unassigned = diagnoses.filter((d) => d.eligible && d.kind === 'unassigned').map(toRow)

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title="Stuck tickets"
        description={`Tickets of the last ${DAYS} days (older tickets, made before this page existed, only for the last ${OLDER_TICKET_DAYS} days) where an automatic step did not happen (a mail to the OEM, a Business Rule, a CVM approval). Press Run on a row to do only the missing steps. Every 15 minutes the system also retries the safe ones by itself, 3 times at most.`}
      />
      <StuckTicketsClient broken={broken} unassigned={unassigned} checked={ids.length} total={total} checkError={checkError} />
    </div>
  )
}
