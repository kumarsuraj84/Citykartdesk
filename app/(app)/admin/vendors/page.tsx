import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { VendorsClient, type VendorCompanyRow, type VendorPersonRow } from './VendorsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vendors' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export default async function VendorsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'platform_owner'].includes(profile.role)) redirect('/home')
  const orgId = profile.org_id ?? ''
  const admin = createAdminClient() as unknown as Db

  const [{ data: companies }, { data: people }] = await Promise.all([
    admin.from('vendor_companies').select('id, name, is_active').eq('org_id', orgId).order('name', { ascending: true }),
    admin.from('profiles').select('id, full_name, is_active, vendor_company_id, vendor_role').eq('org_id', orgId).not('vendor_company_id', 'is', null).order('full_name', { ascending: true }),
  ])

  const peopleRows = (people ?? []) as VendorPersonRow[]
  const companyRows: VendorCompanyRow[] = ((companies ?? []) as { id: string; name: string; is_active: boolean }[]).map((c) => ({
    ...c,
    technicians: peopleRows.filter((p) => p.vendor_company_id === c.id && p.vendor_role === 'technician' && p.is_active).length,
    managers: peopleRows.filter((p) => p.vendor_company_id === c.id && p.vendor_role === 'manager' && p.is_active).length,
  }))

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="Vendors"
        description="The vendor and OEM companies whose engineers log in to work AC tickets and the tickets of Vendor Programs. The default PO approvers are not here: each line has its own on its own screen (Admin > Vendor Programs). A technician works the tickets given to him; a manager only views all tickets of his company's technicians."
      />
      <VendorsClient companies={companyRows} people={peopleRows} />
    </div>
  )
}
