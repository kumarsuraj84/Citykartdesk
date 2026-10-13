// Where to send a person after a sign-in / link step. Only a path inside this site is accepted (audit D-034): anything else, such as a full
// address, "//host", "/\host", "@host" or ".host" (which would turn "https://our.site" + next into another host), falls back to the default.

export function safeNextPath(raw: string | null | undefined, fallback = '/home'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2000) return fallback
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback
  // the path must stay on this site once it is resolved
  try {
    const base = 'http://site.invalid'
    const u = new URL(raw, base)
    if (u.origin !== base) return fallback
  } catch {
    return fallback
  }
  return raw
}
