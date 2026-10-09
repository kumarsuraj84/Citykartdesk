import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// A very small check the pop-ups ask every few seconds: this person's unread count and, when "since" is given, the unread
// notifications created after it. Read with the signed-in person's own session, so nobody can see anyone else's.
export async function GET(req: Request) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'not signed in' }, { status: 401 })

  const sinceRaw = new URL(req.url).searchParams.get('since')
  const sinceMs = sinceRaw ? Date.parse(sinceRaw) : NaN
  const since = Number.isFinite(sinceMs) ? new Date(sinceMs).toISOString() : null

  const supabase = await createClient()
  const [list, unread] = await Promise.all([
    since
      ? supabase
          .from('notifications')
          .select('id, type, title, body, link, request_id, metadata, created_at, actor:profiles!notifications_actor_id_fkey (full_name)')
          .eq('user_id', profile.id)
          .is('read_at', null)
          .is('archived_at', null)
          .gt('created_at', since)
          // the newest ten (a person away for a while must still get the latest ones), handed back oldest first
          .order('created_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] as never[] }),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).is('read_at', null).is('archived_at', null),
  ])

  const rows = ((list.data ?? []) as unknown as { id: string; type: string; title: string; body: string | null; link: string | null; request_id: string | null; metadata: Record<string, unknown> | null; created_at: string; actor: { full_name: string } | { full_name: string }[] | null }[])
    .map((n) => ({
      id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, request_id: n.request_id, metadata: n.metadata, created_at: n.created_at,
      actor_name: (Array.isArray(n.actor) ? n.actor[0] : n.actor)?.full_name ?? null,
    }))

  const items = rows.reverse()

  // "now" comes from the server, so the next check does not depend on the browser's clock
  return NextResponse.json({ now: new Date().toISOString(), items, unread: unread.count ?? 0 })
}
