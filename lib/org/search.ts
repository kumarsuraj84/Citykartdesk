// Finding a store or an OEM in Admin > Org Structure by typing: capitals do not matter, and every word typed must be somewhere in what is searched.

const hasAll = (text: string, query: string): boolean => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const t = text.toLowerCase()
  return words.every((w) => t.includes(w))
}

const join = (parts: (string | number | null | undefined)[]): string => parts.filter((p) => p !== null && p !== undefined && p !== '').join(' ')

/** A store by its code, name, address, city, state, pincode, cluster, region, priority list, or AMC brand or vendor. */
export function matchesStoreSearch(
  s: { code: string; name: string; address?: string | null; city?: string | null; state?: string | null; pincode?: string | null; cluster?: string | null; region?: string | null
    priority_list?: string | null; ac_amc_brand?: string | null; ac_amc_vendor?: string | null },
  query: string,
): boolean {
  return hasAll(join([s.code, s.name, s.address, s.city, s.state, s.pincode, s.cluster, s.region, s.priority_list, s.ac_amc_brand, s.ac_amc_vendor]), query)
}
