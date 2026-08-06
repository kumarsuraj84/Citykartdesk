import { createClient } from '@supabase/supabase-js'

// Service-role client: bypasses RLS. The worker always scopes writes by the
// channel's org_id explicitly, preserving tenant isolation.
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)
