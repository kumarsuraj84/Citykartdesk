import { Wrench } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenRequest } from '@/lib/vendor/requests'

// For Citykart staff: when a ticket is with an OEM engineer (a vendor technician) say so on the ticket, with what he is waiting for.
// The ticket keeps its ordinary status; this note only explains who has it and why it may be on hold.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export async function VendorNote({ requestId, assignedTo }: { requestId: string; assignedTo: string | null }) {
  if (!assignedTo) return null
  const admin = createAdminClient() as unknown as Db
  const { data: person } = await admin.from('profiles').select('full_name, vendor_company_id, vendor_role').eq('id', assignedTo).maybeSingle()
  if (!person?.vendor_company_id || person.vendor_role !== 'technician') return null
  const [{ data: company }, pending] = await Promise.all([
    admin.from('vendor_companies').select('name').eq('id', person.vendor_company_id).maybeSingle(),
    getOpenRequest(requestId),
  ])
  const waiting = pending ? (pending.kind === 'parts' ? 'Part required (no PO)' : pending.status === 'revision_requested' ? `Revised price asked - waiting for the vendor (quote version ${pending.version})` : `PO requested - waiting for approval (quote version ${pending.version})`) : null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100" role="note">
      <Wrench className="h-4 w-4 shrink-0" />
      <span>
        <span className="font-medium">With vendor:</span> {person.full_name}{company?.name ? ` (${company.name})` : ''}
        {waiting && <> <span className="mx-1 opacity-50">-</span> <span className="font-medium">{waiting}</span></>}
      </span>
    </div>
  )
}
