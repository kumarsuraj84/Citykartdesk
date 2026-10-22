import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { filterPoRows, loadPoRegister } from '@/lib/vendor/register'
import { PageHeader } from '@/components/ui/PageHeader'
import { PoRegisterView } from '@/components/vendor/PoRegisterView'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Purchase orders' }

const STAFF = ['agent', 'manager', 'admin', 'platform_owner']

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string }> }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.vendor_company_id) redirect('/vendor')
  if (!STAFF.includes(profile.role) || !profile.org_id) redirect('/home')
  const sp = await searchParams
  const rows = filterPoRows(await loadPoRegister({ kind: 'staff', orgId: profile.org_id }), sp)
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title="Purchase orders" description="Every PO the vendors asked for, with its number, date, ticket, store, items and amount without GST. Open a waiting one from its ticket to approve or reject it." />
      <PoRegisterView rows={rows} basePath="/purchase-orders" filters={sp} showVendor ticketHref={(r) => (r.status === 'pending' ? `/vendor-po/${r.id}` : `/requests/${r.request_id}`)} />
    </div>
  )
}
