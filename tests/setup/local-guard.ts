// A plain `vitest run` writes real users, tickets and organizations through the Supabase address in .env.local. If that address ever points at
// a server that is not this machine (for example after a production build left its addresses behind in the shell), the tests would write into
// that server's data. This guard refuses to run unless the address is on this machine, or ALLOW_NON_LOCAL_TESTS=1 is set on purpose.
// Kept in its own file (no side effects) so it can be unit tested; tests/setup/env.ts calls it once after .env.local is loaded.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'host.docker.internal'])

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase())
}

/** Throws a plain-words error when any configured Supabase address is not on this machine. Returns quietly otherwise. */
export function assertLocalSupabase(env: Record<string, string | undefined> = process.env): void {
  if (env.ALLOW_NON_LOCAL_TESTS === '1') return
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'] as const) {
    const raw = env[name]
    if (!raw || !raw.trim()) continue
    let host: string
    try { host = new URL(raw).hostname } catch { throw new Error(`[tests] refusing to run: ${name} is not a valid address, so it cannot be shown to be local.`) }
    if (!isLoopbackHost(host)) {
      throw new Error(
        `[tests] refusing to run: ${name} points at "${host}", which is not this machine. The tests create and change real rows in that database. ` +
        `Point .env.local at the local Supabase (http://127.0.0.1:54321), or set ALLOW_NON_LOCAL_TESTS=1 if you really mean it.`,
      )
    }
  }
}
