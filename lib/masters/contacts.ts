// The OEM e-mail addresses listed in the AC and Genset sheets, with a readable name for each. Used to recognise an OEM's reply to a ticket and to offer OEM contacts
// when copying people. The first name found for an address wins (an address listed for several units keeps one name).

import { fetchAllPages } from '@/lib/queries/paging'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type SheetOemContact = { name: string; emails: string[] }

export async function loadSheetOemContacts(db: Db, orgId: string): Promise<SheetOemContact[]> {
  // QA-D021: read in pages (one answer is cut at 1,000 rows by the data service; the AC sheet has more than 2,000 units)
  const pages = (table: string, cols: string) => fetchAllPages<Record<string, unknown>>((from, to) => db.from(table).select(cols).eq('org_id', orgId).is('removed_at', null).order('id', { ascending: true }).range(from, to))
  const [ac, gs] = await Promise.all([
    pages('master_ac_units', 'amc_vendor, brand, emails').then((r) => ({ data: r.rows })),
    pages('master_gensets', 'brand, emails').then((r) => ({ data: r.rows })),
  ])
  const out = new Map<string, string[]>()
  const add = (name: string, emails: string[] | null) => out.set(name, [...new Set([...(out.get(name) ?? []), ...(emails ?? [])])])
  for (const u of (ac.data ?? []) as unknown as { amc_vendor: string | null; brand: string | null; emails: string[] | null }[]) add(`AC OEM${u.amc_vendor || u.brand ? ` (${u.amc_vendor || u.brand})` : ''}`, u.emails)
  for (const g of (gs.data ?? []) as unknown as { brand: string | null; emails: string[] | null }[]) add(`Genset OEM${g.brand ? ` (${g.brand})` : ''}`, g.emails)
  return [...out].map(([name, emails]) => ({ name, emails }))
}
