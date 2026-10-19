// Where the AC fields of each service are, and how many open AC tickets each store has (the Server Room AC is not one of the store's counted
// ACs). One place for the Report Analytics reports and the Smart Dashboard, so both show the same AC Not Working % and red flags.
// The count covers every open AC ticket of the organisation, whatever a report's or the viewer's own filters are: it is the store's position,
// and must not change when someone narrows a list.

import { getServiceFormFieldsForOrg } from '@/lib/forms/sections'
import { fetchAllPages } from '@/lib/queries/paging'
import { acFormFields, answerText, isServerRoomAc, type AcFormFields } from '@/lib/reporting/analytics/facts'
import { DEFAULT_REPORT_STATUSES } from '@/lib/reporting/analytics/catalog'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

const MAX_ROWS = 50_000

export interface AcContext {
  /** per service id: where its AC form fields are */
  acFields: Map<string, AcFormFields>
  /** open AC tickets per store code (Server Room AC left out) */
  openAcByStore: Map<string, number>
  /** services that go to an OEM (AC servicing) */
  acServiceIds: string[]
}

export async function loadAcContext(admin: AnyClient, orgId: string): Promise<AcContext> {
  const fields = await getServiceFormFieldsForOrg(admin, orgId)
  const byService = new Map<string, typeof fields>()
  for (const f of fields) byService.set(f.serviceId, [...(byService.get(f.serviceId) ?? []), f])
  const acFields = new Map<string, AcFormFields>([...byService.entries()].map(([id, list]) => [id, acFormFields(list)]))

  const { data: acServices } = await admin.from('services').select('id').eq('org_id', orgId).eq('auto_oem_routing', true)
  const acServiceIds = ((acServices ?? []) as { id: string }[]).map((s) => s.id)

  const openAcByStore = new Map<string, number>()
  if (acServiceIds.length > 0) {
    type Row = { service_id: string; form_data: Record<string, unknown> | null; requester: { store: { code: string } | null } | null }
    // D-019: every page is read; an error on any page throws instead of quietly giving smaller counts
    const { rows } = await fetchAllPages<Row>((from, to) => admin.from('requests')
      .select('service_id, form_data, requester:profiles!requests_requester_id_fkey(store:stores!profiles_store_id_fkey(code))')
      .eq('org_id', orgId).in('service_id', acServiceIds).in('status', DEFAULT_REPORT_STATUSES)
      .order('id', { ascending: true }).range(from, to), { maxRows: MAX_ROWS })
    for (const r of rows) {
      const code = r.requester?.store?.code
      if (!code) continue
      const f = acFields.get(r.service_id)?.acNo
      const acNo = f ? answerText((r.form_data ?? {})[f.id], f.options) : ''
      if (isServerRoomAc(acNo)) continue
      openAcByStore.set(code, (openAcByStore.get(code) ?? 0) + 1)
    }
  }
  return { acFields, openAcByStore, acServiceIds }
}
