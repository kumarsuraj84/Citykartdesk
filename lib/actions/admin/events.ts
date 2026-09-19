'use server'

import { getCurrentProfile } from '@/lib/queries/profiles'
import { createAdminClient } from '@/lib/supabase/admin'
import { toCSV } from '@/lib/export/csv'
import { EVENT_KINDS } from '@/lib/events/record'

export interface EventFilters {
  days: number
  kind?: string
  userId?: string
  q?: string
}

export interface EventRow {
  id: number
  created_at: string
  user_id: string | null
  user_name: string
  session_id: string | null
  kind: string
  path: string | null
  target: string | null
  message: string | null
  detail: unknown
}

const PAGE_LIMIT = 300
const EXPORT_LIMIT = 50_000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) throw new Error('Unauthorized.')
  if (!profile.org_id) throw new Error('Your account is not linked to an organisation.')
  return profile
}

async function fetchEvents(orgId: string, f: EventFilters, limit: number): Promise<EventRow[]> {
  const admin = createAdminClient() as unknown as AnyClient
  const days = Math.min(Math.max(Math.floor(f.days) || 15, 1), 90)
  let query = admin
    .from('app_event_log')
    .select('id, created_at, user_id, session_id, kind, path, target, message, detail')
    .eq('org_id', orgId)
    .gte('created_at', new Date(Date.now() - days * 86_400_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(limit)
  if (f.kind && (EVENT_KINDS as readonly string[]).includes(f.kind)) query = query.eq('kind', f.kind)
  if (f.userId) query = query.eq('user_id', f.userId)
  if (f.q?.trim()) {
    // Strip characters that have meaning in the filter grammar.
    const q = f.q.trim().replace(/[%,()*]/g, ' ').slice(0, 80)
    query = query.or(`path.ilike.%${q}%,target.ilike.%${q}%,message.ilike.%${q}%`)
  }
  const { data, error } = await query
  if (error) throw new Error('Failed to load events.')

  const rows = (data ?? []) as Omit<EventRow, 'user_name'>[]
  const ids = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => !!v))]
  const names = new Map<string, string>()
  if (ids.length) {
    const { data: profiles } = await admin.from('profiles').select('id, full_name').in('id', ids)
    for (const p of (profiles ?? []) as { id: string; full_name: string | null }[]) names.set(p.id, p.full_name ?? '')
  }
  return rows.map((r) => ({ ...r, user_name: (r.user_id && names.get(r.user_id)) || '' }))
}

export async function listEvents(filters: EventFilters): Promise<{ rows: EventRow[]; error?: string }> {
  try {
    const profile = await requireAdmin()
    return { rows: await fetchEvents(profile.org_id!, filters, PAGE_LIMIT) }
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'Failed to load events.' }
  }
}

/** CSV for sharing with support/dev: newest first, up to 50,000 rows. */
export async function exportEventsCsv(filters: EventFilters): Promise<string> {
  const profile = await requireAdmin()
  const rows = await fetchEvents(profile.org_id!, filters, EXPORT_LIMIT)
  return toCSV(
    rows.map((r) => ({ ...r, detail: r.detail == null ? '' : JSON.stringify(r.detail) })),
    [
      { key: 'created_at', label: 'Time (UTC)' },
      { key: 'user_name', label: 'User' },
      { key: 'user_id', label: 'User ID' },
      { key: 'session_id', label: 'Session' },
      { key: 'kind', label: 'Kind' },
      { key: 'path', label: 'Page' },
      { key: 'target', label: 'Clicked / Target' },
      { key: 'message', label: 'Message' },
      { key: 'detail', label: 'Detail' },
    ],
  )
}
