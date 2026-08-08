'use client'
import { createClient } from '@/lib/supabase/client'
import type { Json } from '@/types/database'

export async function reportError(opts: {
  error_type: 'crash' | 'error' | 'feedback'
  message: string
  stack?: string
  url?: string
  metadata?: Record<string, unknown>
}) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    // Get org_id from profile
    let org_id: string | null = null
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', user.id).single()
      org_id = profile?.org_id ?? null
    }

    await supabase.from('error_reports').insert({
      app: 'citykart-desk',
      error_type: opts.error_type,
      message: opts.message,
      stack: opts.stack ?? null,
      url: opts.url ?? (typeof window !== 'undefined' ? window.location.href : null),
      metadata: (opts.metadata ?? {}) as Json,
      org_id,
      user_id: user?.id ?? null,
    })
  } catch {
    // Silent fail — never let error reporting break the app
  }
}
