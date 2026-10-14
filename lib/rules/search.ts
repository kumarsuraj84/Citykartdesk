// Finding a business rule by typing part of its name (or its description): case does not matter, every word typed must be somewhere in the name or description.

export function matchesRuleSearch(rule: { name: string; description?: string | null }, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = `${rule.name} ${rule.description ?? ''}`.toLowerCase()
  return words.every((w) => text.includes(w))
}
