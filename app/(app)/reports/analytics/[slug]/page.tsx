import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getCurrentProfile, getEnabledModules } from '@/lib/queries/profiles'
import {
  loadAgeBucketReport, loadTicketDetailReport, loadTicketTreeReport, loadStoreAcReport, type ReportBase,
} from '@/lib/queries/report-analytics'
import { canUseReportAnalytics, findAnalyticsReport, parseStatuses, reportTitleForGroup } from '@/lib/reporting/analytics/catalog'
import { FACETS, facetDef, parseFacetSelection, selectionParams } from '@/lib/reporting/analytics/facets'
import { columnsFor, layoutById, layoutUsesOem, NOT_SET, type TicketTree, type TreeNode } from '@/lib/reporting/analytics/ticket-tree'
import { STORE_AC_GROUPS } from '@/lib/reporting/analytics/store-ac'
import { DEFAULT_RED_FLAG_PERCENT, NSO_MONTHS } from '@/lib/reporting/analytics/facts'
import { AgeSummaryView } from '@/components/reports/analytics/AgeSummaryView'
import { AnalyticsFilters, type FacetSelectProps } from '@/components/reports/analytics/AnalyticsFilters'
import { TicketDetailTable } from '@/components/reports/analytics/TicketDetailTable'
import { TicketTreeView } from '@/components/reports/analytics/TicketTreeView'
import { StoreAcView } from '@/components/reports/analytics/StoreAcView'
import { ExportTicketDetailButton } from '@/components/reports/analytics/ExportTicketDetailButton'
import { STATUS_LABELS } from '@/lib/constants/requests'

type SP = Record<string, string | string[] | undefined>

const ymd = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '')
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

function treeHasNotSet(tree: TicketTree): boolean {
  const walk = (n: TreeNode): boolean => n.name === NOT_SET || n.children.some(walk)
  return tree.levels.some((l) => l === 'cluster' || l === 'region') && tree.roots.some(walk)
}

export default async function AnalyticsReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<SP>
}) {
  const { slug } = await params
  const sp = await searchParams

  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.org_id) redirect('/home')
  if (!canUseReportAnalytics(profile.role)) redirect('/home')
  if (!(await getEnabledModules()).includes('requests')) redirect('/home')

  const statuses = parseStatuses(sp.status)
  const services = sp.service === undefined ? [] : Array.isArray(sp.service) ? sp.service : [sp.service]
  const rf = Number(first(sp.rf))
  const redFlagPercent = Number.isFinite(rf) && rf > 0 && rf <= 1000 ? rf : DEFAULT_RED_FLAG_PERCENT
  const common = {
    group: first(sp.group), services, preset: first(sp.range), from: first(sp.from), to: first(sp.to), statuses,
    facets: parseFacetSelection(sp, FACETS.map((f) => f.key)), redFlagPercent,
  }

  const back = (
    <Link href="/reports/analytics" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" /> Report Analytics
    </Link>
  )
  const notFound = (message: string) => (
    <div className="space-y-3">
      {back}
      <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
        <p className="text-sm font-medium text-foreground">{message}</p>
      </div>
    </div>
  )

  const def = findAnalyticsReport(slug)
  if (!def) return notFound('This report does not exist.')

  // ── pieces every report shares ──
  const filterBar = async (res: ReportBase, extras?: React.ReactNode, keyExtra = '') => {
    const fromStr = ymd(res.range.from)
    const toStr = ymd(res.range.to)
    const facets: FacetSelectProps[] = res.facets.keys.map((k) => ({
      key: k, label: facetDef(k).label, value: res.facets.selection[k] ?? '', options: res.facets.options[k],
    }))
    return (
      <AnalyticsFilters
        key={`${res.team.id}|${res.selectedServiceIds.join('.')}|${res.range.preset}|${fromStr}|${toStr}|${res.statuses.join(',')}|${JSON.stringify(res.facets.selection)}|${keyExtra}`}
        groups={res.groups}
        groupId={res.team.id}
        services={res.services}
        selectedServiceIds={res.selectedServiceIds}
        preset={res.range.preset}
        from={fromStr}
        to={toStr}
        statuses={res.statuses}
        resetHref={`/reports/analytics/${def.slug}?group=${encodeURIComponent(res.team.id)}`}
        facets={facets}
        extras={extras}
      />
    )
  }

  const scopeText = (res: ReportBase) => {
    const servicesText = res.selectedServiceIds.length >= res.services.length ? 'All services' : res.services.filter((s) => res.selectedServiceIds.includes(s.id)).map((s) => s.name).join(', ')
    return `${res.team.name} · ${servicesText} · created ${res.range.label} · ${res.statuses.map((s) => STATUS_LABELS[s]).join(', ')}`
  }

  const nsoNote = (res: ReportBase) => res.facets.keys.includes('storeType') ? (
    <p className="text-[11px] text-muted-foreground">
      NSO = a store with no open date, or one that opened in the last {NSO_MONTHS} months (from the Store Master). Every filter lists only the values that fit the other filters, with the number of tickets in brackets.
    </p>
  ) : null

  const heading = (title: string, description: string, action?: React.ReactNode) => (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )

  const truncatedNote = (res: ReportBase) => res.truncated ? <span className="ml-2 font-semibold text-destructive">(very large result — showing the first part only)</span> : null
  const countText = (n: number, res: ReportBase) => (
    <>
      <span className="font-semibold text-foreground">{n}</span> ticket{n === 1 ? '' : 's'}
      {n !== res.totalBeforeFilters && <span> (of {res.totalBeforeFilters})</span>}
    </>
  )
  const exportCommon = (res: ReportBase) => ({
    slug: def.slug, group: res.team.id, services: res.selectedServiceIds, preset: res.range.preset, from: ymd(res.range.from), to: ymd(res.range.to),
    statuses: res.statuses, filters: selectionParams(res.facets.selection),
  })
  const input = 'mt-1 block rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  // ── Ticket detail ──
  if (def.kind === 'ticket-detail') {
    const res = await loadTicketDetailReport(profile, slug, common)
    if ('error' in res) return notFound(res.error)
    return (
      <div className="space-y-4">
        {back}
        {heading(reportTitleForGroup(def, res.team.name), def.description, <ExportTicketDetailButton {...exportCommon(res)} />)}
        {await filterBar(res)}
        <p className="text-xs text-muted-foreground">{scopeText(res)} · {countText(res.rows.length, res)}{truncatedNote(res)}</p>
        {nsoNote(res)}
        <TicketDetailTable rows={res.rows} />
      </div>
    )
  }

  // ── Grouped ticket reports ──
  if (def.kind === 'ticket-tree') {
    const res = await loadTicketTreeReport(profile, slug, { ...common, layout: first(sp.layout), minTickets: first(sp.min) })
    if ('error' in res) return notFound(res.error)
    const cfg = def.tree!
    const layouts = cfg.layouts.map((id) => layoutById(id, cfg.defaultLayout)).filter((l) => res.acAvailable || !layoutUsesOem(l))
    const columns = columnsFor(cfg.columns, res.layout.levels, res.acAvailable)
    const extras = (
      <>
        <label className="text-xs font-medium text-muted-foreground">
          Group by
          <select name="layout" defaultValue={res.layout.id} data-auto className={`${input} min-w-[14rem]`}>
            {layouts.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        {cfg.minTicketsFilter && (
          <label className="text-xs font-medium text-muted-foreground" title="Leave at 1 to see every store. Use 2 or more to see only stores that keep raising tickets.">
            Stores with at least
            <span className="mt-1 flex items-center gap-1.5">
              <input type="number" name="min" min={1} max={1000} defaultValue={res.minTickets} className={`w-20 ${input} mt-0`} />
              <span className="text-xs text-muted-foreground">tickets</span>
            </span>
          </label>
        )}
      </>
    )
    const shown = res.tree.grand.total
    return (
      <div className="space-y-4">
        {back}
        {heading(reportTitleForGroup(def, res.team.name), def.description)}
        {await filterBar(res, extras, `${res.layout.id}|${res.minTickets}`)}
        <p className="text-xs text-muted-foreground">
          {scopeText(res)} · {countText(shown, res)}
          {res.minTickets > 1 && <span> · stores with at least {res.minTickets} tickets</span>}
          {truncatedNote(res)}
        </p>
        {nsoNote(res)}
        {res.acAvailable
          ? <p className="text-[11px] text-muted-foreground">An OEM, AC number and AC OEM ticket are shown only for tickets of services that go to an OEM ({res.services.filter((s) => s.oemRouted).map((s) => s.name).join(', ')}). A store is the requester account of the store; tickets raised by head office staff show under the requester’s name.</p>
          : <p className="text-[11px] text-muted-foreground">A store is the requester account of the store; tickets raised by head office staff show under the requester’s name.</p>}
        {treeHasNotSet(res.tree) && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Some stores have no cluster or region yet, so they are listed under “{NOT_SET}”. They are filled by uploading the Store Master (Admin → Organization Structure → Stores).
          </p>
        )}
        <TicketTreeView
          key={`${res.layout.id}|${res.minTickets}|${JSON.stringify(res.facets.selection)}|${res.range.preset}|${res.statuses.join(',')}|${res.selectedServiceIds.join('.')}|${res.team.id}`}
          tree={res.tree}
          columns={columns}
          defaultDepth={cfg.level === 'stores' ? res.layout.levels.length - 1 : 'tickets'}
          exportProps={{ ...exportCommon(res), layout: res.layout.id, minTickets: res.minTickets }}
        />
      </div>
    )
  }

  // ── Store AC Not Working ──
  if (def.kind === 'store-ac') {
    const res = await loadStoreAcReport(profile, slug, { ...common, groupBy: first(sp.by) })
    if ('error' in res) return notFound(res.error)
    const extras = (
      <>
        <label className="text-xs font-medium text-muted-foreground">
          Group by
          <select name="by" defaultValue={res.groupBy} data-auto className={`${input} min-w-[12rem]`}>
            {STORE_AC_GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-muted-foreground" title="A store is red-flagged when its AC Not Working % is above this.">
          Red flag above
          <span className="mt-1 flex items-center gap-1.5">
            <input type="number" name="rf" min={1} max={1000} defaultValue={res.redFlagPercent} className={`w-20 ${input} mt-0`} />
            <span className="text-xs text-muted-foreground">%</span>
          </span>
        </label>
      </>
    )
    return (
      <div className="space-y-4">
        {back}
        {heading(reportTitleForGroup(def, res.team.name), def.description)}
        {await filterBar(res, extras, `${res.groupBy}|${res.redFlagPercent}`)}
        <p className="text-xs text-muted-foreground">{scopeText(res)} · {countText(res.report.grand.total, res)}{truncatedNote(res)}</p>
        {nsoNote(res)}
        {res.selectedServiceIds.length === 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">This group has no AC service (a service that goes to an OEM), so there is nothing to report here.</p>
        )}
        <StoreAcView
          key={`${res.groupBy}|${res.redFlagPercent}|${JSON.stringify(res.facets.selection)}|${res.range.preset}|${res.statuses.join(',')}|${res.selectedServiceIds.join('.')}|${res.team.id}`}
          report={res.report}
          groupBy={res.groupBy}
          redFlagPercent={res.redFlagPercent}
          defaultCollapsed={false}
          exportProps={{ ...exportCommon(res), groupBy: res.groupBy, redFlagPercent: res.redFlagPercent }}
        />
      </div>
    )
  }

  // ── Tickets summary ──
  const res = await loadAgeBucketReport(profile, slug, common)
  if ('error' in res) return notFound(res.error)

  return (
    <div className="space-y-4">
      {back}
      {heading(reportTitleForGroup(def, res.team.name), def.description)}
      {await filterBar(res)}
      <p className="text-xs text-muted-foreground">{scopeText(res)} · {countText(res.ticketCount, res)}{truncatedNote(res)}</p>
      {nsoNote(res)}
      <p className="text-[11px] text-muted-foreground">
        The last two columns count tickets created and resolved {res.day.word === 'today' ? 'today' : `on ${res.day.label} (the end of the chosen dates)`}, whatever their status, with the same filters.
      </p>
      <AgeSummaryView summary={res.summary} dayWord={res.day.word} exportProps={exportCommon(res)} />
    </div>
  )
}
