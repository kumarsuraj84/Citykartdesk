// Which Vendor Programs are the AC line and the Genset line. The AC Calendar of the Smart Dashboard counts the tickets of those two lines (machine work for an OEM); the other
// programs (RO purifier, sensors ...) are not AC or genset tickets and stay out of it.
// A program is recognised by its name: "AC" (alone or as a word, for example "AC service") is the AC line; a name with "genset" or "generator" is the Genset line.
// (The old per-category setting `auto_oem_kind` still counts too, until it is removed.)

export type AssetKind = 'ac' | 'genset'

export function assetKindOfProgramName(name: string | null | undefined): AssetKind | null {
  const n = (name ?? '').toLowerCase()
  if (/gen\s*-?\s*set|generator/.test(n)) return 'genset'
  if (/(^|[^a-z])ac([^a-z]|$)|air\s*-?\s*condition/.test(n)) return 'ac'
  return null
}

/** The kind of each category that is AC or Genset work: the old category setting first, else the kind of the program the category belongs to. */
export function assetKindByCategory(
  categories: { id: string; auto_oem_kind: string | null; program_id: string | null }[],
  programs: { id: string; name: string }[],
): Map<string, AssetKind> {
  const programKind = new Map(programs.map((p) => [p.id, assetKindOfProgramName(p.name)]))
  const out = new Map<string, AssetKind>()
  for (const c of categories) {
    if (c.auto_oem_kind === 'ac' || c.auto_oem_kind === 'genset') { out.set(c.id, c.auto_oem_kind); continue }
    const k = c.program_id ? programKind.get(c.program_id) ?? null : null
    if (k) out.set(c.id, k)
  }
  return out
}
