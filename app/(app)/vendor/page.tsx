import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { countByBox, getVendorTickets, isVendorTab, searchVendorTickets, ticketsOfTab, waitingForVendor, type VendorTab } from '@/lib/queries/vendor'
import { isVendor, isVendorBox, vendorRoleOf, VENDOR_BOX_LABELS, VENDOR_BOX_ORDER, VENDOR_BOX_TURN, type VendorBox } from '@/lib/vendor/access'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge, PriorityBadge } from '@/components/requests/RequestBadges'
import { formatDateTime } from '@/lib/utils'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const BOX_TONE: Record<VendorBox, string> = {
  revise_price: 'border-rose-300 bg-rose-50/70 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100',
  open: 'border-sky-200 bg-sky-50/60 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200',
  in_process: 'border-indigo-200 bg-indigo-50/60 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200',
  po_required: 'border-amber-200 bg-amber-50/60 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
  part_required: 'border-orange-200 bg-orange-50/60 text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-200',
  resolved: 'border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
  cancelled: 'border-slate-200 bg-slate-50/60 text-slate-700 dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-200',
}

const TAB_LABEL: Record<VendorTab, string> = { tickets: 'My tickets', pms: 'AC PMS tickets' }

export default async function VendorDashboardPage({ searchParams }: { searchParams: Promise<{ box?: string; q?: string; tab?: string }> }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!isVendor(profile)) redirect('/home')
  const { box, q, tab: tabParam } = await searchParams
  const tab: VendorTab = isVendorTab(tabParam) ? tabParam : 'tickets'
  const isManager = vendorRoleOf(profile) === 'manager'

  const everything = await getVendorTickets()
  const all = ticketsOfTab(everything, tab)   // the two tabs never share a ticket
  const counts = countByBox(all)
  // he lands on what needs him: a revised price first, otherwise the tickets to start
  const activeBox: VendorBox = isVendorBox(box) ? box : counts.revise_price > 0 ? 'revise_price' : 'open'
  const rows = searchVendorTickets(all.filter((r) => r.box === activeBox), q ?? '')

  return (
    <div className="space-y-4 max-w-6xl">
      <PageHeader
        title={tab === 'pms' ? (isManager ? 'AC PMS tickets of my company' : 'AC PMS tickets') : (isManager ? 'Tickets of my company' : 'My tickets')}
        description={tab === 'pms'
          ? (isManager ? 'The scheduled AC PMS (preventive maintenance) tickets of the technicians of your company (view only).' : 'Scheduled AC PMS (preventive maintenance) visits given to you by Citykart. Open a ticket to start the visit.')
          : (isManager ? 'All tickets of the technicians of your company (view only).' : 'Tickets given to you by Citykart. Open a ticket to start working.')}
      />

      <nav aria-label="Ticket kind" className="flex gap-1 border-b border-border">
        {(['tickets', 'pms'] as const).map((t) => {
          const waiting = waitingForVendor(ticketsOfTab(everything, t))
          return (
            <Link
              key={t}
              href={`/vendor?tab=${t}`}
              aria-current={tab === t ? 'page' : undefined}
              className={cn('-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-semibold transition-colors', tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
            >
              {TAB_LABEL[t]}
              {waiting > 0 && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">{waiting}</span>}
            </Link>
          )
        })}
      </nav>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {VENDOR_BOX_ORDER.map((b) => (
          <Link
            key={b}
            href={`/vendor?tab=${tab}&box=${b}`}
            className={cn('rounded-xl border p-3 transition-shadow hover:shadow-sm', BOX_TONE[b], activeBox === b && 'ring-2 ring-primary/40')}
            aria-current={activeBox === b ? 'page' : undefined}
          >
            <div className="text-2xl font-semibold tabular-nums">{counts[b]}</div>
            <div className="text-xs font-medium leading-tight">{VENDOR_BOX_LABELS[b]}</div>
            <div className="mt-0.5 text-[10px] opacity-70">{VENDOR_BOX_TURN[b]}</div>
          </Link>
        ))}
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="box" value={activeBox} />
        <input
          name="q" defaultValue={q ?? ''} placeholder="Search ticket, store, AC, OEM ticket number…"
          className="w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
        />
        <button type="submit" className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Search</button>
        {q && <Link href={`/vendor?tab=${tab}&box=${activeBox}`} className="text-sm text-muted-foreground hover:text-foreground">Clear</Link>}
      </form>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Ticket</th>
              <th className="px-3 py-2 font-medium">Store</th>
              {tab === 'tickets' && <th className="px-3 py-2 font-medium">AC</th>}
              {tab === 'tickets' && <th className="px-3 py-2 font-medium">OEM ticket no.</th>}
              {isManager && <th className="px-3 py-2 font-medium">Technician</th>}
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Priority</th>
              <th className="px-3 py-2 font-medium">Raised</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr><td colSpan={(tab === 'tickets' ? 7 : 5) + (isManager ? 1 : 0)} className="px-3 py-8 text-center text-muted-foreground">No tickets in “{VENDOR_BOX_LABELS[activeBox]}”.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link href={`/vendor/tickets/${r.id}`} className="font-medium text-primary hover:underline">{r.request_no}</Link>
                  <div className="max-w-[18rem] truncate text-xs text-muted-foreground">{r.title}</div>
                  {r.reopen_count > 0 && <span className="mt-0.5 inline-block rounded-full border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">Reopened ×{r.reopen_count}</span>}
                </td>
                <td className="px-3 py-2">{r.store_name ?? '—'}{r.store_code && <span className="ml-1 text-xs text-muted-foreground">({r.store_code})</span>}</td>
                {tab === 'tickets' && <td className="px-3 py-2">{r.ac_label ?? '—'}</td>}
                {tab === 'tickets' && <td className="px-3 py-2">{r.oem_ticket_no ?? '—'}</td>}
                {isManager && <td className="px-3 py-2">{r.assignee_name ?? '—'}</td>}
                <td className="px-3 py-2"><StatusBadge status={r.status} size="sm" /></td>
                <td className="px-3 py-2"><PriorityBadge priority={r.priority} size="sm" /></td>
                <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
