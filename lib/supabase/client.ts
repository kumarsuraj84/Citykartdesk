import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/types/database'
import { resilientFetch } from '@/lib/supabase/resilient-fetch'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: resilientFetch },
      // When the public address is https, the sign-in cookie this browser client writes (on a token refresh) is marked Secure, like the ones the server writes
      // (lib/supabase/server.ts, proxy.ts). On plain http it must not be, or the browser would refuse to store it. NEXT_PUBLIC_APP_URL is fixed at build time.
      // The cookie is deliberately not HttpOnly: this client reads the session from it in the browser (see docs/HTTPS-AND-CSP-PLAN.md).
      cookieOptions: { secure: (process.env.NEXT_PUBLIC_APP_URL ?? '').startsWith('https') },
    }
  )
}
