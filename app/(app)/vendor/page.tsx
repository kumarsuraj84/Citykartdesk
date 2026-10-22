import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { countByBox, getVendorTickets, searchVendorTickets } from '@/lib/queries/vendor'
import { isVendor, isVendorBox, vendorRoleOf, VENDOR_BOX_LABELS, VENDOR_BOX_ORDER, type VendorBox } from '@/lib/vendor/access'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge, PriorityBadge } from '@/components/requests/RequestBadges'
import { formatDateTime } from '@/lib/utils'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const BOX_TONE: Record<VendorBox, string> = {
  open: 'border-sky-200 bg-sky-50/60 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200',
  in_process: 'border-indigo-200 bg-indigo-50/60 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200',
  po_required: 'border-amber-200 bg-amber-50/60 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
  part_required: 'border-orange-200 bg-orange-50/60 text-orange-800 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-200',
  resolved: 'border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
  cancelled: 'border-slate-200 bg-slate-50/60 text-slate-700 dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-200',
}

export default async function VendorDashboardPage({ searchParams }: { searchParams: Promise<{ box?: string; q?: string }> }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!isVendor(profile)) redirect('/home')
  const { box, q } = await searchParams
  const activeBox: VendorBox = isVendorBox(box) ? box : 'open'
  const isManager = vendorRoleOf(profile) === 'manager'

  const all = await getVendorTickets()
  const counts = countByBox(all)
  const rows = searchVendorTickets(all.filter((r) => r.box === activeBox), q ?? '')

  return (
    <div className="space-y-4 max-w-6xl">
      <PageHeader
        title={isManager ? 'Tickets of my company' : 'My tickets'}
        description={isManager ? 'All tickets of the technicians of your company (view only).' : 'Tickets given to you by Citykart. Open a ticket to start working.'}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {VENDOR_BOX_ORDER.map((b) => (
          <Link
            key={b}
            href={`/vendor?box=${b}`}
            className={cn('rounded-xl border p-3 transition-shadow hover:shadow-sm', BOX_TONE[b], activeBox === b && 'ring-2 ring-primary/40')}
            aria-current={activeBox === b ? 'page' : undefined}
          >
            <div className="text-2xl font-semibold tabular-nums">{counts[b]}</div>
            <div className="text-xs font-medium leading-tight">{VENDOR_BOX_LABELS[b]}</div>
          </Link>
        ))}
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="box" value={activeBox} />
        <input
          name="q" defaultValue={q ?? ''} placeholder="Search ticket, store, AC, OEM ticket number…"
          className="w-full max-w-sm rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
        />
        <button type="submit" className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Search</button>
        {q && <Link href={`/vendor?box=${activeBox}`} className="text-sm text-muted-foreground hover:text-foreground">Clear</Link>}
      </form>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Ticket</th>
              <th className="px-3 py-2 font-medium">Store</th>
              <th className="px-3 py-2 font-medium">AC</th>
              <th className="px-3 py-2 font-medium">OEM ticket no.</th>
              {isManager && <th className="px-3 py-2 font-medium">Technician</th>}
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Priority</th>
              <th className="px-3 py-2 font-medium">Raised</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr><td colSpan={isManager ? 8 : 7} className="px-3 py-8 text-center text-muted-foreground">No tickets in “{VENDOR_BOX_LABELS[activeBox]}”.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link href={`/vendor/tickets/${r.id}`} className="font-medium text-primary hover:underline">{r.request_no}</Link>
                  <div className="max-w-[18rem] truncate text-xs text-muted-foreground">{r.title}</div>
                </td>
                <td className="px-3 py-2">{r.store_name ?? '—'}{r.store_code && <span className="ml-1 text-xs text-muted-foreground">({r.store_code})</span>}</td>
                <td className="px-3 py-2">{r.ac_label ?? '—'}</td>
                <td className="px-3 py-2">{r.oem_ticket_no ?? '—'}</td>
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
