import 'server-only'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'

/**
 * The Zoho Data tab's own connection to the ZOHO holding database (zohomigrationdb on the database server).
 *
 * This is deliberately SEPARATE from everything else in CK Desk:
 *  - it is a different database, reached with a different login (`zoho_report`), which can only SELECT;
 *  - no CK Desk table is read through it and no Zoho row is ever copied into CK Desk;
 *  - every session is opened read-only, so even a mistake in a query cannot change a Zoho row;
 *  - when the login is not set up on this server the tab simply says so, and nothing else in the app notices.
 *
 * Settings (app/standalone/.env.local on the app server, or .env.local locally):
 *   ZOHO_DB_HOST=10.0.0.205
 *   ZOHO_DB_PORT=5432                  (optional, 5432 by default)
 *   ZOHO_DB_NAME=zohomigrationdb       (optional, zohomigrationdb by default)
 *   ZOHO_DB_USER=zoho_report
 *   ZOHO_DB_PASSWORD=...               (the read-only password; it is never shown in the app or in a log)
 * or, instead of all five:
 *   ZOHO_DB_URL=postgresql://zoho_report:...@10.0.0.205:5432/zohomigrationdb
 */

const DEFAULT_DB = 'zohomigrationdb'
const STATEMENT_TIMEOUT_MS = 25_000
/** a few connections are plenty: the tab is used by a handful of managers, and long reports are paged */
const MAX_CLIENTS = 4

export type ZohoDbStatus = { ready: true } | { ready: false; reason: string }

function cfg() {
  const url = process.env.ZOHO_DB_URL?.trim()
  const host = process.env.ZOHO_DB_HOST?.trim()
  const user = process.env.ZOHO_DB_USER?.trim()
  const password = process.env.ZOHO_DB_PASSWORD
  return { url, host, user, password }
}

/** Whether the Zoho tab can be used at all, in words a person can act on. Never mentions the password itself. */
export function zohoDbStatus(): ZohoDbStatus {
  const { url, host, user, password } = cfg()
  if (url) return { ready: true }
  if (!host) return { ready: false, reason: 'ZOHO_DB_HOST is not set, so the app does not know where the Zoho database is.' }
  if (!user) return { ready: false, reason: 'ZOHO_DB_USER is not set, so the app has no read-only login for the Zoho database.' }
  if (!password) return { ready: false, reason: 'ZOHO_DB_PASSWORD is not set, so the app cannot sign in to the Zoho database.' }
  return { ready: true }
}

// one pool per server process; kept on globalThis so a code reload in development does not leave pools behind
const g = globalThis as unknown as { __zohoPool?: Pool }

function pool(): Pool {
  if (g.__zohoPool) return g.__zohoPool
  const status = zohoDbStatus()
  if (!status.ready) throw new ZohoNotConfigured(status.reason)
  const { url, host, user, password } = cfg()
  // every session is opened read-only and with a time limit, so no query from this tab can change or stall the Zoho database
  const options = `-c default_transaction_read_only=on -c statement_timeout=${STATEMENT_TIMEOUT_MS} -c idle_in_transaction_session_timeout=30000`
  const common = { max: MAX_CLIENTS, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000, application_name: 'ckdesk-zoho-tab', options }
  const p = url
    ? new Pool({ connectionString: url, ...common })
    : new Pool({
        host,
        port: Number(process.env.ZOHO_DB_PORT ?? 5432) || 5432,
        database: process.env.ZOHO_DB_NAME?.trim() || DEFAULT_DB,
        user,
        password,
        ...common,
      })
  // a broken idle connection must not take the server down
  p.on('error', (e) => console.error('[zoho-db] an idle connection failed:', e.message))
  g.__zohoPool = p
  return p
}

export class ZohoNotConfigured extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ZohoNotConfigured'
  }
}

export class ZohoReadFailed extends Error {
  constructor(message: string, readonly original?: unknown) {
    super(message)
    this.name = 'ZohoReadFailed'
  }
}

/** The connection error in words the team can act on, with nothing secret in it. */
function friendly(e: unknown): string {
  const code = (e as { code?: string })?.code
  const msg = String((e as { message?: string })?.message ?? e)
  if (code === '28P01' || /password authentication failed/i.test(msg)) return 'The Zoho database refused the read-only login (wrong password, or the login was changed). Set ZOHO_DB_PASSWORD again on the app server.'
  if (code === '28000' || /no pg_hba.conf entry/i.test(msg)) return 'The Zoho database does not allow this server to connect. The database server needs a rule for the app server.'
  if (code === '3D000') return 'The Zoho database name is wrong (ZOHO_DB_NAME).'
  if (code === '42501') return 'The read-only login is not allowed to read that table. Its SELECT rights need to be granted again on the database server.'
  if (code === '57014' || /statement timeout/i.test(msg)) return 'That report took too long on the Zoho database and was stopped. Please narrow it (a shorter date range) and try again.'
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) return 'The Zoho database did not answer on that address and port.'
  if (code === 'ETIMEDOUT' || /ETIMEDOUT|timeout expired/i.test(msg)) return 'The Zoho database could not be reached in time. It may be busy or the network is blocked.'
  if (code === 'ENOTFOUND' || /ENOTFOUND|getaddrinfo/i.test(msg)) return 'The Zoho database address could not be found (ZOHO_DB_HOST).'
  if (code === '25006' || /read-only transaction/i.test(msg)) return 'That would have changed the Zoho data, so the database refused it. The Zoho tab only ever reads.'
  return 'The Zoho database could not be read just now. Please try again in a minute.'
}

/**
 * Runs one read-only query on the Zoho database. Values ALWAYS go in as parameters ($1, $2, ...) - never put a value
 * a person typed into the query text.
 */
export async function zohoQuery<T extends QueryResultRow>(text: string, params: ReadonlyArray<unknown> = []): Promise<T[]> {
  let client: PoolClient
  try {
    client = await pool().connect()
  } catch (e) {
    if (e instanceof ZohoNotConfigured) throw e
    console.error('[zoho-db] could not open a connection:', (e as Error)?.message)
    throw new ZohoReadFailed(friendly(e), e)
  }
  try {
    const res = await client.query<T>(text, params as unknown[])
    return res.rows
  } catch (e) {
    // the query text is safe to log (it has no values in it); the parameters are not logged
    console.error('[zoho-db] a read failed:', (e as Error)?.message, '|', text.replace(/\s+/g, ' ').slice(0, 200))
    throw new ZohoReadFailed(friendly(e), e)
  } finally {
    client.release()
  }
}

/** Is the Zoho database actually reachable right now? Used by the tab to show one clear message instead of a crash. */
export async function zohoPing(): Promise<{ ok: true; tables: number; tickets: number } | { ok: false; reason: string }> {
  const status = zohoDbStatus()
  if (!status.ready) return { ok: false, reason: status.reason }
  try {
    const rows = await zohoQuery<{ tables: string; tickets: string }>(
      `select (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')::text as tables,
              (select count(*) from zoho_ticket)::text as tickets`,
    )
    return { ok: true, tables: Number(rows[0]?.tables ?? 0), tickets: Number(rows[0]?.tickets ?? 0) }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'The Zoho database could not be read.' }
  }
}
