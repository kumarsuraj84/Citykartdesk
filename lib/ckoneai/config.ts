import { getSecret } from '@/lib/secrets'

// Settings of the CKOneAI assistant link, all from the server's environment (the owner changes them on the app server, nothing else can):
//   CKONEAI_ENABLED=1                      the kill switch: anything else = the assistant is OFF (menu hidden, every route answers "off")
//   CKONEAI_BASE_URL=http://10.0.0.82:8100  where CKOneAI listens (a plain address: no login, path, query or fragment in it)
//   CKONEAI_BRIDGE_SECRET_CKDESK            the shared signing secret (lib/secrets.ts; at least 32 characters; typed by the owner on the server)
//   CKONEAI_PILOT_USER_IDS=<id>,<id>        the pilot allow-list: profile ids that may use it; "*" = every signed-in person except vendor logins
// A missing or wrong setting switches the assistant OFF with a reason for the log. It never opens anything.

export const MIN_BRIDGE_SECRET = 32

export type CkoneaiConfig =
  | { on: false; reason: string }
  | { on: true; baseUrl: string; secret: string; pilot: '*' | ReadonlySet<string> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readCkoneaiConfig(env: Record<string, string | undefined> = process.env): CkoneaiConfig {
  if ((env.CKONEAI_ENABLED ?? '').trim() !== '1') return { on: false, reason: 'CKONEAI_ENABLED is not 1' }

  // read through lib/secrets when the real environment is used, straight from the given map in tests
  const secret = (env === process.env ? getSecret('ckoneai_bridge') : (env.CKONEAI_BRIDGE_SECRET_CKDESK ?? '').trim()) ?? ''
  if (secret.length < MIN_BRIDGE_SECRET) return { on: false, reason: `the bridge secret is missing or shorter than ${MIN_BRIDGE_SECRET} characters` }

  let url: URL
  try { url = new URL((env.CKONEAI_BASE_URL ?? '').trim()) } catch { return { on: false, reason: 'CKONEAI_BASE_URL is not an address' } }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { on: false, reason: 'CKONEAI_BASE_URL must start with http:// or https://' }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    return { on: false, reason: 'CKONEAI_BASE_URL must be a plain address (no login, path, query or fragment)' }
  }

  const raw = (env.CKONEAI_PILOT_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (raw.length === 0) return { on: false, reason: 'CKONEAI_PILOT_USER_IDS is empty (list the pilot people, or * for everyone)' }
  if (raw.includes('*')) return { on: true, baseUrl: url.origin, secret, pilot: '*' }
  const ids = raw.map((s) => s.toLowerCase())
  if (ids.some((s) => !UUID.test(s))) return { on: false, reason: 'CKONEAI_PILOT_USER_IDS has an entry that is not a profile id' }
  return { on: true, baseUrl: url.origin, secret, pilot: new Set(ids) }
}

/** Is this person on the pilot list? (A vendor login is refused before this is asked.) */
export function inPilot(cfg: Extract<CkoneaiConfig, { on: true }>, userId: string): boolean {
  return cfg.pilot === '*' || cfg.pilot.has(userId.toLowerCase())
}
