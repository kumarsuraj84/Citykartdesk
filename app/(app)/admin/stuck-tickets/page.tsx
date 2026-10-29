import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { diagnoseTickets, type AutomationDiagnosis, type Db } from '@/lib/automation/diagnose'
import { StuckTicketsClient, type StuckRow } from './StuckTicketsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Stuck tickets' }

const DAYS = 14
const LIMIT = 400
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
  const { data } = await db.from('requests').select('id').eq('org_id', profile.org_id).in('status', ['open', 'in_progress', 'waiting_user', 'pending_approval'])
    .gte('created_at', since).order('created_at', { ascending: false }).limit(LIMIT)
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id)
  const cutoff = olderCutoffMs()
  const diagnoses = (await diagnoseTickets(db, ids)).filter((d) => d.tracked || new Date(d.createdAt).getTime() >= cutoff)
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
      <StuckTicketsClient broken={broken} unassigned={unassigned} checked={ids.length} />
    </div>
  )
}
