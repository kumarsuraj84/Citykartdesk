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
import { MoveWorkbench } from './MoveWorkbench'
import { RunPanel } from './RunPanel'
import { MovedSwitch } from './MovedSwitch'
import { RefreshPanel } from './RefreshPanel'
import { ApprovalPanel } from './ApprovalPanel'
import { unmatchedPeople } from '@/lib/zoho/transfer/people-warning'
import { SERVICE_FIELDS } from '@/lib/zoho/queries'
import { zohoUdfLabel } from '@/lib/zoho/transfer/udf-labels'
import { loadRecentRuns } from '@/lib/zoho/transfer/batch'
import { movedTicketsActive } from '@/lib/zoho/transfer/silent'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Move Zoho tickets to CK Desk' }

type Search = Record<string, string | undefined>
type Sla = { response: string | null; resolution: string | null; state: 'met' | 'breached' | 'running' | 'none' }
type Row = { plan: TicketPlan; subject: string | null; sla: Sla | null }

const input = 'rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground'
/** The plain Zoho name of a field key: a named column ("Serial number") or a custom field ("ETR"). */
const fieldName = (key: string) => (key.startsWith('udf:') ? zohoUdfLabel(key.slice(4)) : SERVICE_FIELDS.find((f) => f.col === key)?.label ?? key)
const ist = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—')
const istDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }) : '—')
const istTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' }) : '')
const HOW: Record<string, string> = { saved: 'matched by hand', email: 'matched by e-mail', name: 'matched by name', 'new-inactive': 'will be created (inactive)', none: 'no CK Desk person' }

export default async function ZohoMovePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const profile = await getCurrentProfile()
  const head = <PageHeader title="Move Zoho tickets to CK Desk" description="Search, tick the tickets that can be moved, move them. Nobody is emailed or notified." />
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
  const reasons = new Map<PlanProblemCode, number>()
  for (const r of rows) for (const p of r.plan.problems) reasons.set(p.code, (reasons.get(p.code) ?? 0) + 1)
  const people = unmatchedPeople(rows.map((r) => r.plan))
  const unmatchedCount = people.requesters.length + people.technicians.length
  const scopeQs = encodeURIComponent(new URLSearchParams(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString())

  const nonEmpty = Object.entries(filters).filter(([, v]) => v)
  const FILTER_LABEL: Record<string, string> = { numbers: 'Numbers', template: 'Template', category: 'Category', status: 'Status', requester: 'Requester', technician: 'Technician', from: 'From', to: 'To', moved: 'Moved' }
  const MOVED_LABEL: Record<string, string> = { not: 'not moved yet', only: 'already moved' }
  const activeFilters = nonEmpty.map(([k, v]) => ({ key: k, text: `${FILTER_LABEL[k] ?? k}: ${k === 'moved' ? MOVED_LABEL[String(v)] ?? v : String(v) || '(blank)'}` }))
  const fixHref = `/zoho/mapping${nonEmpty.length ? `?scope=${scopeQs}` : ''}`
  const reasonChips = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, title: PROBLEM_TITLES[code], count }))

  /**
   * The table cells of one ticket after its tick box (drawn here, on the server, and handed to the table that owns the tick boxes).
   * Two densities from the same markup: COMPACT (the default: two short lines per ticket, so 6 tickets fit in the frozen window) hides what is marked `ck-extra`, shows what is marked
   * `ck-compact-only`, and cuts every `ck-line` to one line; FULL shows everything. The full text is always in the cell's tooltip (title).
   */
  const cellsOf = ({ plan: p, subject, sla }: Row) => {
    const zohoPath = [p.zoho.template, p.zoho.category, p.zoho.subcategory, p.zoho.item].filter(Boolean).join(' › ') || '—'
    const ckPath = p.service ? `${p.service.name}${p.category ? ` › ${p.category.name}` : ''}${p.subCategory ? ` › ${p.subCategory.name}` : ''}` : null
    const mappedText = `fields: ${p.mappedFields.length} mapped${p.mappedFields.length ? ` (${p.mappedFields.map((f) => fieldName(f.zohoField)).join(', ')})` : ''}`
    const fieldsText = `${mappedText}${p.unmappedFields.length ? `; ${p.unmappedFields.length} not mapped (${p.unmappedFields.map(fieldName).join(', ')})` : ''}`
    const slaText = sla ? (sla.state === 'breached' ? 'SLA breached' : sla.state === 'met' ? 'SLA met' : sla.state === 'running' ? 'SLA running' : 'no SLA deadline') : null
    const slaTone = sla?.state === 'breached' ? 'text-red-700 dark:text-red-400' : sla?.state === 'met' ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'
    const first = p.problems[0]
    return [
      <td key="c1" className="px-2 py-1.5" title={subject ?? undefined}><span className="ck-extra block text-muted-foreground">{p.zohoNo}</span><span className="block whitespace-nowrap font-semibold text-foreground">{p.newNo ?? '—'}</span>{subject && <span className="ck-line block max-w-[12rem] text-[11px] text-muted-foreground">{subject}</span>}</td>,
      <td key="c2" className="px-2 py-1.5 whitespace-nowrap" title={ist(p.createdAt)}><span className="block text-foreground">{istDate(p.createdAt)}</span><span className="block text-[11px] text-muted-foreground">{istTime(p.createdAt)}</span></td>,
      <td key="c3" className="px-2 py-1.5" title={`${zohoPath}\n${ckPath ?? 'not mapped'}${p.template ? `\nform: ${p.template.name}` : ''}\n${fieldsText}`}>
        <span className="ck-line block text-foreground">{ckPath ?? <em className="text-red-700 dark:text-red-400">not mapped</em>}</span>
        <span className="ck-line block text-[11px] text-muted-foreground">{zohoPath}</span>
        {p.template && <span className="ck-extra block text-[11px] text-muted-foreground">form: {p.template.name}</span>}
        <span className="ck-extra block text-[11px] text-muted-foreground">{mappedText}{p.unmappedFields.length ? <span className="text-amber-700 dark:text-amber-400">; {p.unmappedFields.length} not mapped ({p.unmappedFields.map(fieldName).join(', ')})</span> : ''}</span>
      </td>,
      <td key="c4" className="px-2 py-1.5"><span className="ck-line block text-foreground">{p.requester.name ?? '—'}</span><span className="ck-line block text-[11px] text-muted-foreground">{HOW[p.requester.how]}</span></td>,
      <td key="c5" className="px-2 py-1.5"><span className="ck-line block text-foreground">{p.technician.zohoName ?? '—'}</span><span className="ck-line block text-[11px] text-muted-foreground" title={p.technician.ckName ? `CK Desk: ${p.technician.ckName} (${HOW[p.technician.how]})` : undefined}>{p.technician.ckName ? `CK Desk: ${p.technician.ckName} (${HOW[p.technician.how]})` : 'no CK Desk person; open tickets use CK Desk rules'}</span></td>,
      <td key="c6" className="px-2 py-1.5"><span className="ck-line block text-muted-foreground">{p.zoho.status ?? '—'}</span><span className="ck-line block text-foreground">{p.statusLabel ?? <em className="text-red-700 dark:text-red-400">not mapped</em>}</span></td>,
      <td key="c7" className="px-2 py-1.5 whitespace-nowrap" title={sla ? `respond by ${ist(sla.response)}\nresolve by ${ist(sla.resolution)}` : undefined}>
        <span className="block capitalize text-foreground">{p.priority ?? '—'}</span>
        {sla && <span className="ck-extra block text-[11px] text-muted-foreground">respond by {ist(sla.response)}</span>}
        {sla && <span className="ck-extra block text-[11px] text-muted-foreground">resolve by {ist(sla.resolution)}</span>}
        {slaText ? <span className={`block text-[11px] font-medium ${slaTone}`}>{slaText}</span> : <span className="block text-[11px] text-muted-foreground">—</span>}
      </td>,
      <td key="c8" className="px-2 py-1.5" title={p.problems.map((x) => x.text).join('\n') || undefined}>
        {p.ready ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Ready</span>
          : <><span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-300">Cannot move yet</span>
            {first && <span className="ck-compact-only ck-line mt-0.5 block text-[11px] text-red-800 dark:text-red-300">{first.text}{p.problems.length > 1 ? ` (+${p.problems.length - 1} more)` : ''}</span>}
            <ul className="ck-extra mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-red-800 dark:text-red-300">{p.problems.map((x) => <li key={x.code}>{x.text}</li>)}</ul></>}
      </td>,
    ]
  }

  // the yellow notice about people CK Desk does not know yet: one line, the names on demand
  const notice = unmatchedCount > 0 ? (
    <details role="alert" className="rounded-md border border-amber-300 bg-amber-50 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
      <summary className="cursor-pointer px-3 py-1.5 font-semibold">
        CK Desk does not recognise {unmatchedCount} {unmatchedCount === 1 ? 'person' : 'people'} on these tickets yet
        <span className="ml-2 font-normal">
          {people.requesters.length > 0 && <Link href={`/zoho/mapping?tab=requesters&scope=${scopeQs}`} className="mr-3 font-medium underline">Match the requesters →</Link>}
          {people.technicians.length > 0 && <Link href={`/zoho/mapping?tab=technicians&scope=${scopeQs}`} className="font-medium underline">Match the technicians →</Link>}
        </span>
      </summary>
      <div className="space-y-1 border-t border-amber-200 px-3 py-2 dark:border-amber-900/50">
        <p>If you move them as they are, an empty inactive profile is made for each one, and the ticket or the conversation entries are attached to it. Match them first, then move.</p>
        {people.requesters.length > 0 && <p><strong>Requesters:</strong> {people.requesters.map((p) => `${p.name} (${p.tickets} ticket${p.tickets === 1 ? '' : 's'})`).join(', ')}</p>}
        {people.technicians.length > 0 && <p><strong>Technicians:</strong> {people.technicians.map((p) => `${p.name} (${p.tickets} ticket${p.tickets === 1 ? '' : 's'})`).join(', ')}</p>}
      </div>
    </details>
  ) : null

  return (
    <div className="space-y-3">
      {head}

      {/* The filters: open until you search, then one line with what you searched for (press it to change). The table below gets the room. */}
      <details className="rounded-lg border border-border bg-card" open={!searched}>
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs">
          <span className="font-semibold text-foreground">Filters</span>
          {activeFilters.length === 0 && <span className="text-muted-foreground">none (the newest {PREVIEW_LIMIT} tickets)</span>}
          {activeFilters.map((f) => <span key={f.key} className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-foreground">{f.text}</span>)}
          {result && <span className="text-muted-foreground">· <strong className="text-foreground">{result.total.toLocaleString('en-IN')}</strong> match</span>}
          <span className="ml-auto text-primary">{searched ? 'Change filters' : ''}</span>
        </summary>
        <form method="get" className="border-t border-border p-3">
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
              {nonEmpty.length > 0 && <Link href={fixHref} className="text-xs font-medium text-primary hover:underline">Map only what these tickets need →</Link>}
              <Link href="/zoho/mapping" className="text-xs text-muted-foreground hover:text-foreground">Open the whole mapping</Link>
            </span>
          </div>
        </form>
      </details>

      {failure && <NotConnected reason={failure} />}
      {!failure && !searched && <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Choose at least one filter (or press <em>Preview these tickets</em> with none to see the newest {PREVIEW_LIMIT}).</p>}

      {result && (
        <MoveWorkbench
          rows={rows.map((r) => ({ zohoNo: r.plan.zohoNo, ready: r.plan.ready, codes: r.plan.problems.map((x) => x.code), cells: cellsOf(r) }))}
          reasons={reasonChips} total={result.total} truncated={result.truncated} canMove={canMove} limit={MOVE_BATCH_LIMIT} unmatched={unmatchedCount} notice={notice} fixHref={nonEmpty.length ? fixHref : null}
        />
      )}

      {/* The less used tools, out of the way: move everything that matches, fill in moved tickets, send approvals, alerts on moved tickets, the run history, and how moving works. */}
      <details className="rounded-lg border border-border bg-card">
        <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
          <span className="font-semibold text-foreground">More tools</span>
          <span className="text-muted-foreground">move everything that matches · fill in moved tickets · send approvals · alerts on moved tickets are {movedActive ? 'ON' : 'OFF'}{recentRuns.length ? ` · ${recentRuns.length} recent runs` : ''} · how moving works</span>
        </summary>
        <div className="space-y-3 border-t border-border p-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <strong>How moving works.</strong> Tick up to {MOVE_BATCH_LIMIT}, or use &quot;Move everything that matches&quot; below (in steps of {MOVE_BATCH_LIMIT}, with Pause and Stop). Moving creates the CK Desk ticket <code>ZOHO-</code> + the Zoho number with the Zoho created time, copies the conversation, and works out the
            SLA from that time. It sends <strong>no mail, WhatsApp, push or survey</strong> and never changes Zoho. An open ticket is given to a technician by CK Desk&apos;s own rules; a finished ticket keeps the matched Zoho technician.
          </div>
          <MovedSwitch active={movedActive} canChange={canMove} />
          <RunPanel filters={filters} canMove={canMove} />
          <RefreshPanel canMove={canMove} />
          <ApprovalPanel canMove={canMove} />
          {recentRuns.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-3 text-xs">
              <p className="text-sm font-semibold text-foreground">Recent runs ({recentRuns.length})</p>
              <table className="mt-2 w-full text-left"><thead><tr className="border-b border-border text-muted-foreground"><th className="py-1 pr-3 font-medium">Started</th><th className="py-1 pr-3 font-medium">State</th><th className="py-1 pr-3 font-medium">Asked</th><th className="py-1 pr-3 font-medium">Moved</th><th className="py-1 font-medium">Not moved</th></tr></thead>
                <tbody>{recentRuns.map((r) => <tr key={r.id} className="border-b border-border/60"><td className="py-1 pr-3">{ist(r.started_at)}</td><td className="py-1 pr-3 capitalize">{r.state}</td><td className="py-1 pr-3 tabular-nums">{r.asked}</td><td className="py-1 pr-3 tabular-nums text-emerald-700 dark:text-emerald-400">{r.moved}</td><td className="py-1 tabular-nums">{r.failed}</td></tr>)}</tbody></table>
            </div>
          )}
        </div>
      </details>
    </div>
  )
}
