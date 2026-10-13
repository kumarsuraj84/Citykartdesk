// The Docker container of the Postgres database that the app under test is pointed at, derived from SUPABASE_URL so that
// a test's own SQL cross-check can never read a different database than the one the code under test reads.
const BY_API_PORT: Record<string, string> = {
  '54321': 'supabase_db_citykart_desk', // the dev stack (supabase/config.toml)
  '55421': 'supabase_db_ckdesk_audit', // the disposable audit stack (audit-2026-10/env)
}

export function dbContainer(): string {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  let port = ''
  try { port = new URL(url).port } catch { /* handled below */ }
  const name = BY_API_PORT[port]
  if (!name) throw new Error(`[db-container] SUPABASE_URL "${url}" does not belong to a known local stack; refusing to run SQL cross-checks.`)
  return name
}
