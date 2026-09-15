import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resilientFetch } from '@/lib/supabase/resilient-fetch'

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
      global: { fetch: resilientFetch },
    }
  )
}
