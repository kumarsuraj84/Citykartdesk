import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { isVendor, vendorRoleOf } from '@/lib/vendor/access'
import { filterPoRows, loadPoRegister } from '@/lib/vendor/register'
import { PageHeader } from '@/components/ui/PageHeader'
import { PoRegisterView } from '@/components/vendor/PoRegisterView'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My POs' }

export default async function VendorPosPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string }> }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!isVendor(profile)) redirect('/home')
  const sp = await searchParams
  const rows = filterPoRows(await loadPoRegister({ kind: 'vendor' }), sp)
  const manager = vendorRoleOf(profile) === 'manager'
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={manager ? 'POs of my company' : 'My POs'} description="Purchase orders you asked Citykart for: number, date, ticket, store, items and amount without GST." />
      <PoRegisterView rows={rows} basePath="/vendor/pos" filters={sp} showVendor={manager} ticketHref={(r) => `/vendor/tickets/${r.request_id}`} />
    </div>
  )
}
