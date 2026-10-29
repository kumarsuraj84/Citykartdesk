import 'server-only'
import { googleSheetsSource, type SheetsSource } from './google'
import { csvDirSource, demoSheetsDir } from './demo'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }> }

/**
 * Where the sheets are read from for an organisation: the saved Google connection (the refresh token is read back from the Vault), or - local demo only, never in a
 * production build - CSV files on this computer. Shared by the AC / Genset / CVM / PMS copy and by the Vendor Programs copy.
 */
export async function sheetsSourceForOrg(db: Db, orgId: string): Promise<{ source: SheetsSource; conn: { status?: string } | null } | { error: string }> {
  const demoDir = demoSheetsDir()
  if (demoDir) return { source: csvDirSource(demoDir), conn: null }
  const { data } = await db.from('master_google_connection').select('secret_ref, status').eq('org_id', orgId).maybeSingle()
  if (!data?.secret_ref) return { error: 'not connected' }
  const { data: secret } = await db.rpc('masters_read_credential', { p_ref: data.secret_ref })
  if (!secret) return { error: 'saved Google connection not found' }
  let refreshToken: string
  try { refreshToken = (JSON.parse(String(secret)) as { refresh_token: string }).refresh_token } catch { return { error: 'saved Google connection is unreadable' } }
  return { source: googleSheetsSource(refreshToken), conn: data }
}
