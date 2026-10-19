// The OEM e-mail addresses listed in the AC and Genset sheets, with a readable name for each. Used to recognise an OEM's reply to a ticket and to offer OEM contacts
// when copying people. The first name found for an address wins (an address listed for several units keeps one name).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type SheetOemContact = { name: string; emails: string[] }

export async function loadSheetOemContacts(db: Db, orgId: string): Promise<SheetOemContact[]> {
  const [ac, gs] = await Promise.all([
    db.from('master_ac_units').select('amc_vendor, brand, emails').eq('org_id', orgId).is('removed_at', null),
    db.from('master_gensets').select('brand, emails').eq('org_id', orgId).is('removed_at', null),
  ])
  const out = new Map<string, string[]>()
  const add = (name: string, emails: string[] | null) => out.set(name, [...new Set([...(out.get(name) ?? []), ...(emails ?? [])])])
  for (const u of (ac.data ?? []) as { amc_vendor: string | null; brand: string | null; emails: string[] | null }[]) add(`AC OEM${u.amc_vendor || u.brand ? ` (${u.amc_vendor || u.brand})` : ''}`, u.emails)
  for (const g of (gs.data ?? []) as { brand: string | null; emails: string[] | null }[]) add(`Genset OEM${g.brand ? ` (${g.brand})` : ''}`, g.emails)
  return [...out].map(([name, emails]) => ({ name, emails }))
}
