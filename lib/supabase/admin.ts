import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resilientFetch } from '@/lib/supabase/resilient-fetch'
import { readVerifiedUserId } from '@/lib/auth/verified-user'

/**
 * The server's own client bypasses row security, so the database cannot tell WHO a change is for. Inside a request this wrapper names the
 * signed-in person (the proxy-signed id, never anything the browser sent) in x-actor-id, plus the request id; the System Log's audit triggers
 * read them and ONLY trust them for the service role. Outside a request (cron, scripts) nothing is added.
 */
async function actorAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    const merged = new Headers(init?.headers)
    const id = readVerifiedUserId(h)
    if (typeof id === 'string') merged.set('x-actor-id', id)
    const rid = h.get('x-request-id')
    if (rid) merged.set('x-request-id', rid)
    return resilientFetch(input, { ...init, headers: merged })
  } catch {
    return resilientFetch(input, init)
  }
}

/**
 * Service-role client for server-side operations that must bypass RLS:
 * - Writing request_activity
 * - Writing notifications
 * - Approval state transitions
 * - Auto-close jobs
 *
 * Never expose this client to the browser.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: { fetch: actorAwareFetch },
    }
  )
}
