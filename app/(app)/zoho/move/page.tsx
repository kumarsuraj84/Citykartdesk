import Link from 'next/link'
import { PageHeader } from '@/components/ui/PageHeader'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { zohoDbStatus } from '@/lib/zoho/db'
import { resolveSlaDeadlines } from '@/lib/sla/resolve'
import { NotConnected } from '../_components/NotConnected'
import {
  loadCkCatalogue, loadMovedNumbers, loadPeopleDirectory, loadSavedMapping, loadTicketsForPreview, loadZohoFacts,
  matchPerson, savedPeopleMap, toMappings, PREVIEW_LIMIT, type MoveFilters,
} from '@/lib/zoho/transfer/data'
import { PROBLEM_TITLES, planTicket, type PlanProblemCode, type TicketPlan } from '@/lib/zoho/transfer/plan'
import { isFinishedCkStatus } from '@/lib/zoho/transfer/suggest'
import { MOVE_BATCH_LIMIT } from '@/lib/zoho/transfer/move'
import { MoveControls } from './MoveControls'
import { RunPanel } from './RunPanel'
import { MovedSwitch } from './MovedSwitch'
import { RefreshPanel } from './RefreshPanel'
import { loadRecentRuns } from '@/lib/zoho/transfer/batch'
import { movedTicketsActive } from '@/lib/zoho/transfer/silent'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Move Zoho tickets to CK Desk' }

type Search = Record<string, string | undefined>
type Sla = { response: string | null; resolution: string | null; state: 'met' | 'breached' | 'running' | 'none' }
type Row = { plan: TicketPlan; subject: string | null; sla: Sla | null }

const input = 'rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground'
const ist = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—')
const HOW: Record<string, string> = { saved: 'matched by hand', email: 'matched by e-mail', name: 'matched by name', 'new-inactive': 'will be created (inactive)', none: 'no CK Desk person' }

export default async function ZohoMovePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const profile = await getCurrentProfile()
  const head = <PageHeader title="Move Zoho tickets to CK Desk" description="Choose tickets, see exactly what CK Desk will do with each one, then move the ready ones. Nobody is emailed or notified." />
  const status = zohoDbStatus()
  if (!status.ready) return <div className="space-y-4">{head}<NotConnected reason={status.reason} /></div>
  const orgId = profile?.org_id as string | undefined
  if (!orgId) return <div className="space-y-4">{head}<p className="text-sm text-muted-foreground">Your account is not linked to an organisation.</p></div>

  const filters: MoveFilters = {
    numbers: sp.numbers?.trim() || undefined, status: sp.status || undefined, template: sp.template || undefined, category: sp.category || undefined,
    technician: sp.technician?.trim() || undefined, requester: sp.requester?.trim() || undefined, from: sp.from || undefined, to: sp.to || undefined, moved: sp.moved === 'not' || sp.moved === 'only' ? sp.moved : sp.notMoved === '1' ? 'not' : undefined,
  }
  const searched = Object.values(filters).some(Boolean) || sp.go === '1'

  type Facts = Awaited<ReturnType<typeof loadZohoFacts>>
  let facts: Facts | null = null
  let result: { total: number; truncated: boolean; rows: Row[] } | null = null
  let failure: string | null = null
  try {
    facts = await loadZohoFacts()
    if (searched) {
      const [cat, saved, dir] = await Promise.all([loadCkCatalogue(orgId), loadSavedMapping(orgId), loadPeopleDirectory(orgId)])
      const movedAll = filters.moved ? [...(await loadMovedNumbers(orgId))] : []
      const { total, rows, truncated } = await loadTicketsForPreview(filters, movedAll)
      const moved = await loadMovedNumbers(orgId, rows.map((r) => r.displayId))
      const maps = toMappings(saved)
      const services = new Map(cat.services.map((s) => [s.id, s]))
      const templates = new Map(cat.templates.map((t) => [t.id, { id: t.id, name: t.name }]))
      const reqHand = savedPeopleMap(saved, 'requester', dir)
      const techHand = savedPeopleMap(saved, 'technician', dir)

      // the SLA of each service, so the deadlines can be worked out from the Zoho created time
      const { data: svcRows } = await (createAdminClient() as unknown as { from: (t: string) => any }) // eslint-disable-line @typescript-eslint/no-explicit-any
        .from('services').select('id, sla_policy:sla_policies(config)').eq('org_id', orgId)
      const policy = new Map<string, unknown>(((svcRows ?? []) as { id: string; sla_policy: { config: unknown } | null }[]).map((s) => [s.id, s.sla_policy?.config ?? null]))
      const now = new Date().getTime()

      const built: Row[] = []
      for (const t of rows) {
        const plan = planTicket({
          ticket: t, maps, services, templates,
          requester: matchPerson(dir, reqHand, { email: t.requesterEmail, name: t.requesterName }),
          technician: matchPerson(dir, techHand, { email: t.technicianEmail ?? null, name: t.technicianName }),
          alreadyMoved: moved.has(t.displayId),
        })
        let sla: Sla | null = null
        if (plan.service && plan.createdAt && plan.priority) {
          try {
            const d = await resolveSlaDeadlines(createAdminClient() as never, {
              serviceId: plan.service.id, priority: plan.priority as 'low' | 'medium' | 'high' | 'urgent',
              servicePolicyConfig: policy.get(plan.service.id) as never, from: new Date(plan.createdAt),
            })
            const due = d.resolutionDueAt ? new Date(d.resolutionDueAt).getTime() : null
            const finished = isFinishedCkStatus(plan.status)
            const doneAt = t.resolvedAt ? new Date(t.resolvedAt).getTime() : null
            sla = {
              response: d.responseDueAt, resolution: d.resolutionDueAt,
              state: due === null ? 'none' : finished ? (doneAt !== null ? (doneAt <= due ? 'met' : 'breached') : 'none') : now > due ? 'breached' : 'running',
            }
          } catch { sla = null }
        }
        built.push({ plan, subject: t.subject, sla })
      }
      result = { total, truncated, rows: built }
    }
  } catch (e) {
    failure = e instanceof Error ? e.message : 'The Zoho data could not be read.'
  }

  const canMove = ['admin', 'platform_owner'].includes(profile?.role ?? '')
  const movedActive = await movedTicketsActive(createAdminClient() as never)
  const recentRuns = await loadRecentRuns(orgId).catch(() => [])
  const rows = result?.rows ?? []
  const ready = rows.filter((r) => r.plan.ready).length
  const reasons = new Map<PlanProblemCode, number>()
  for (const r of rows) for (const p of r.plan.problems) reasons.set(p.code, (reasons.get(p.code) ?? 0) + 1)

  return (
    <div className="space-y-4">
      {head}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        <strong>Moving tickets.</strong> Tick up to {MOVE_BATCH_LIMIT}, or use &quot;Move everything that matches&quot; below (in steps of {MOVE_BATCH_LIMIT}, with Pause and Stop). Moving creates the CK Desk ticket <code>ZOHO-</code> + the Zoho number with the Zoho created time, copies the conversation, and works out the
        SLA from that time. It sends <strong>no mail, WhatsApp, push or survey</strong> and never changes Zoho. An open ticket is given to a technician by CK Desk&apos;s own rules; a finished ticket keeps the matched Zoho technician.
      </div>

      <form method="get" className="rounded-lg border border-border bg-card p-3">
        <input type="hidden" name="go" value="1" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs text-muted-foreground">Zoho ticket numbers
            <input name="numbers" defaultValue={sp.numbers ?? ''} placeholder="48213, 48220-48230" className={`${input} block w-full`} /></label>
          <label className="space-y-1 text-xs text-muted-foreground">Zoho template
            <select name="template" defaultValue={sp.template ?? ''} className={`${input} block w-full`}><option value="">All</option>{facts?.templates.map((t) => <option key={t.template} value={t.template}>{t.template || '(blank)'}</option>)}</select></label>
          <label className="space-y-1 text-xs text-muted-foreground">Zoho category
            <select name="category" defaultValue={sp.category ?? ''} className={`${input} block w-full`}><option value="">All</option>{[...new Set(facts?.tree.map((r) => r.category) ?? [])].sort().map((c) => <option key={c} value={c}>{c || '(blank)'}</option>)}</select></label>
          <label className="space-y-1 text-xs text-muted-foreground">Zoho status
            <select name="status" defaultValue={sp.status ?? ''} className={`${input} block w-full`}><option value="">All</option>{facts?.statuses.map((s) => <option key={s.status} value={s.status}>{s.status || '(blank)'}</option>)}</select></label>
          <label className="space-y-1 text-xs text-muted-foreground">Requester (name or e-mail)
            <input name="requester" defaultValue={sp.requester ?? ''} className={`${input} block w-full`} /></label>
          <label className="space-y-1 text-xs text-muted-foreground">Technician (name)
            <input name="technician" defaultValue={sp.technician ?? ''} className={`${input} block w-full`} /></label>
          <label className="space-y-1 text-xs text-muted-foreground">Created from
            <input type="date" name="from" defaultValue={sp.from ?? ''} className={`${input} block w-full`} /></label>
          <label className="space-y-1 text-xs text-muted-foreground">Created up to
            <input type="date" name="to" defaultValue={sp.to ?? ''} className={`${input} block w-full`} /></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-foreground">Moved to CK Desk?
            <select name="moved" defaultValue={sp.moved ?? (sp.notMoved === '1' ? 'not' : '')} className={input}><option value="">All tickets</option><option value="not">Not moved yet</option><option value="only">Already moved</option></select></label>
          <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Preview these tickets</button>
          <Link href="/zoho/move" className="text-xs text-muted-foreground hover:text-foreground">Clear</Link>
          <span className="ml-auto flex flex-wrap items-center gap-3">
            {Object.values(filters).some(Boolean) && (
              <Link href={`/zoho/mapping?scope=${encodeURIComponent(new URLSearchParams(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString())}`} className="text-xs font-medium text-primary hover:underline">Map only what these tickets need →</Link>
            )}
            <Link href="/zoho/mapping" className="text-xs text-muted-foreground hover:text-foreground">Open the whole mapping</Link>
          </span>
        </div>
      </form>

      <MovedSwitch active={movedActive} canChange={canMove} />
      <RunPanel filters={filters} canMove={canMove} />
      <RefreshPanel canMove={canMove} />
      {recentRuns.length > 0 && (
        <details className="rounded-lg border border-border bg-card p-3 text-xs">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">Recent runs ({recentRuns.length})</summary>
          <table className="mt-2 w-full text-left"><thead><tr className="border-b border-border text-muted-foreground"><th className="py-1 pr-3 font-medium">Started</th><th className="py-1 pr-3 font-medium">State</th><th className="py-1 pr-3 font-medium">Asked</th><th className="py-1 pr-3 font-medium">Moved</th><th className="py-1 font-medium">Not moved</th></tr></thead>
            <tbody>{recentRuns.map((r) => <tr key={r.id} className="border-b border-border/60"><td className="py-1 pr-3">{ist(r.started_at)}</td><td className="py-1 pr-3 capitalize">{r.state}</td><td className="py-1 pr-3 tabular-nums">{r.asked}</td><td className="py-1 pr-3 tabular-nums text-emerald-700 dark:text-emerald-400">{r.moved}</td><td className="py-1 tabular-nums">{r.failed}</td></tr>)}</tbody></table>
        </details>
      )}

      {failure && <NotConnected reason={failure} />}
      {!failure && !searched && <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Choose at least one filter (or press <em>Preview these tickets</em> with none to see the newest {PREVIEW_LIMIT}).</p>}

      {result && (
        <>
          <section aria-label="Summary" className="rounded-lg border border-border bg-card p-3">
            <p className="text-sm text-foreground">
              <strong>{result.total.toLocaleString('en-IN')}</strong> Zoho tickets match{result.truncated ? <> — the newest <strong>{rows.length}</strong> are shown</> : null}.
              {' '}<span className="text-emerald-700 dark:text-emerald-400"><strong>{ready}</strong> could be moved</span>,{' '}
              <span className={rows.length - ready ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground'}><strong>{rows.length - ready}</strong> cannot yet</span>.
            </p>
            {reasons.size > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                {[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => (
                  <li key={code} className="rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{PROBLEM_TITLES[code]}: {count}</li>
                ))}
              </ul>
            )}
            <div className="mt-3"><MoveControls canMove={canMove} readyCount={ready} limit={MOVE_BATCH_LIMIT} /></div>
          </section>

          <form id="move-form" onSubmit={undefined} />
          <div className="overflow-x-auto rounded-lg border border-border bg-card" tabIndex={0} role="region" aria-label="Preview of the Zoho tickets">
            <table className="w-full min-w-[1100px] text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Move</th><th className="px-2 py-2 font-medium">Zoho → CK Desk number</th><th className="px-2 py-2 font-medium">Created (same as Zoho)</th>
                  <th className="px-2 py-2 font-medium">Where it goes in CK Desk</th><th className="px-2 py-2 font-medium">Requester</th><th className="px-2 py-2 font-medium">Technician</th>
                  <th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2 font-medium">CK Desk priority and SLA</th><th className="px-2 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ plan: p, subject, sla }) => (
                  <tr key={p.zohoNo} className="border-b border-border/60 align-top">
                    <td className="px-2 py-2">{p.ready && canMove ? <input type="checkbox" form="move-form" name="n" value={p.zohoNo} aria-label={`Move Zoho ticket ${p.zohoNo}`} /> : <span className="text-muted-foreground" aria-hidden="true">–</span>}</td>
                    <td className="px-2 py-2"><span className="block text-muted-foreground">{p.zohoNo}</span><span className="font-semibold text-foreground">{p.newNo ?? '—'}</span>{subject && <span className="block max-w-[14rem] truncate text-[11px] text-muted-foreground" title={subject}>{subject}</span>}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-foreground">{ist(p.createdAt)}</td>
                    <td className="px-2 py-2">
                      <span className="block text-muted-foreground">{[p.zoho.template, p.zoho.category, p.zoho.subcategory, p.zoho.item].filter(Boolean).join(' › ') || '—'}</span>
                      <span className="block text-foreground">{p.service ? <>{p.service.name}{p.category ? ` › ${p.category.name}` : ''}{p.subCategory ? ` › ${p.subCategory.name}` : ''}</> : <em className="text-red-700 dark:text-red-400">not mapped</em>}</span>
                      {p.template && <span className="block text-[11px] text-muted-foreground">form: {p.template.name}</span>}
                      <span className="block text-[11px] text-muted-foreground">fields: {p.mappedFields.length} mapped{p.unmappedFields.length ? `, ${p.unmappedFields.length} not mapped` : ''}</span>
                    </td>
                    <td className="px-2 py-2"><span className="block text-foreground">{p.requester.name ?? '—'}</span><span className="block text-[11px] text-muted-foreground">{HOW[p.requester.how]}</span></td>
                    <td className="px-2 py-2"><span className="block text-foreground">{p.technician.zohoName ?? '—'}</span><span className="block text-[11px] text-muted-foreground">{p.technician.ckName ? `CK Desk: ${p.technician.ckName} (${HOW[p.technician.how]})` : 'no CK Desk person; open tickets use CK Desk rules'}</span></td>
                    <td className="px-2 py-2"><span className="block text-muted-foreground">{p.zoho.status ?? '—'}</span><span className="block text-foreground">{p.statusLabel ?? <em className="text-red-700 dark:text-red-400">not mapped</em>}</span></td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span className="block capitalize text-foreground">{p.priority ?? '—'}</span>
                      {sla ? (<>
                        <span className="block text-[11px] text-muted-foreground">respond by {ist(sla.response)}</span>
                        <span className="block text-[11px] text-muted-foreground">resolve by {ist(sla.resolution)}</span>
                        <span className={`block text-[11px] font-medium ${sla.state === 'breached' ? 'text-red-700 dark:text-red-400' : sla.state === 'met' ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                          {sla.state === 'breached' ? 'SLA breached' : sla.state === 'met' ? 'SLA met' : sla.state === 'running' ? 'SLA running' : 'no SLA deadline'}
                        </span></>) : <span className="block text-[11px] text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2 py-2">
                      {p.ready ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Ready</span>
                        : <><span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-300">Cannot move yet</span>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-red-800 dark:text-red-300">{p.problems.map((x) => <li key={x.code}>{x.text}</li>)}</ul></>}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={9} className="px-2 py-6 text-center text-muted-foreground">No Zoho ticket matches these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
