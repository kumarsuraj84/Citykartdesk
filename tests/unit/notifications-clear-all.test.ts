import { describe, it, expect, vi, beforeEach } from 'vitest'

// "Clear all" moves every notification of the person to Archived and gives back what it changed, so the screen can offer Undo; Undo restores exactly those.
// An in-memory stand-in for the notifications table with the few filters the actions use.

type Row = { id: string; user_id: string; type: string; read_at: string | null; archived_at: string | null }
let table: Row[] = []
let me: { id: string } | null = { id: 'me' }

function builder() {
  const filters: ((r: Row) => boolean)[] = []
  let patch: Partial<Row> | null = null
  let selectCols = false
  let limitN = Infinity
  const b: Record<string, unknown> = {
    select: () => { selectCols = true; return b },
    update: (p: Partial<Row>) => { patch = p; return b },
    eq: (c: keyof Row, v: unknown) => { filters.push((r) => r[c] === v); return b },
    neq: (c: keyof Row, v: unknown) => { filters.push((r) => r[c] !== v); return b },
    is: (c: keyof Row, v: null) => { filters.push((r) => r[c] === v); return b },
    in: (c: keyof Row, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b },
    limit: (n: number) => { limitN = n; return b },
    then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
      const hit = table.filter((r) => filters.every((f) => f(r))).slice(0, limitN)
      if (patch) { for (const r of hit) Object.assign(r, patch); return resolve({ data: selectCols ? hit.map((r) => ({ id: r.id })) : null, error: null }) }
      return resolve({ data: hit.map((r) => ({ id: r.id, read_at: r.read_at })), error: null })
    },
  }
  return b
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: () => builder() }) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => me }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { archiveAllNotifications, restoreArchivedNotifications } from '@/lib/actions/notifications'

const row = (id: string, over: Partial<Row> = {}): Row => ({ id, user_id: 'me', type: 'comment_added', read_at: null, archived_at: null, ...over })

beforeEach(() => {
  me = { id: 'me' }
  table = [
    row('n1'),                                                   // unread
    row('n2', { read_at: '2026-11-01T10:00:00Z' }),              // already read
    row('n3', { type: 'approval_requested' }),                   // an approval request (not listed in the bell)
    row('old', { archived_at: '2026-10-01T00:00:00Z', read_at: '2026-10-01T00:00:00Z' }),   // archived long ago
    row('theirs', { user_id: 'someone-else' }),                  // another person's
  ]
})

describe('Clear all', () => {
  it('archives every notification of the person (and only theirs), marks the unread ones read, and says what it did', async () => {
    const r = await archiveAllNotifications()
    expect(r.error).toBeUndefined()
    expect(r.ids?.sort()).toEqual(['n1', 'n2', 'n3'])
    expect(r.unreadIds?.sort()).toEqual(['n1', 'n3'])
    for (const id of ['n1', 'n2', 'n3']) expect(table.find((x) => x.id === id)!.archived_at).toBe(r.archivedAt)
    expect(table.find((x) => x.id === 'n1')!.read_at).toBe(r.archivedAt)
    expect(table.find((x) => x.id === 'n2')!.read_at).toBe('2026-11-01T10:00:00Z')            // an already-read one keeps its time
    expect(table.find((x) => x.id === 'old')!.archived_at).toBe('2026-10-01T00:00:00Z')        // earlier archive untouched
    expect(table.find((x) => x.id === 'theirs')!.archived_at).toBeNull()                       // nobody else's
  })

  it("the bell's version leaves approval requests alone", async () => {
    const r = await archiveAllNotifications({ excludeApprovalRequests: true })
    expect(r.ids?.sort()).toEqual(['n1', 'n2'])
    expect(table.find((x) => x.id === 'n3')!.archived_at).toBeNull()
  })

  it('does nothing (and says so) when there is nothing to clear', async () => {
    table = table.map((x) => ({ ...x, archived_at: x.archived_at ?? '2026-10-02T00:00:00Z' }))
    const r = await archiveAllNotifications()
    expect(r.ids).toEqual([])
  })

  it('needs a signed-in person', async () => {
    me = null
    expect((await archiveAllNotifications()).error).toBe('Not authenticated.')
  })
})

describe('Undo', () => {
  it('brings back exactly what that Clear all archived, and makes the unread ones unread again', async () => {
    const cleared = await archiveAllNotifications()
    const r = await restoreArchivedNotifications({ archivedAt: cleared.archivedAt!, ids: cleared.ids!, unreadIds: cleared.unreadIds! })
    expect(r.error).toBeUndefined()
    expect(r.restored).toBe(3)
    expect(table.find((x) => x.id === 'n1')).toMatchObject({ archived_at: null, read_at: null })
    expect(table.find((x) => x.id === 'n3')).toMatchObject({ archived_at: null, read_at: null })
    expect(table.find((x) => x.id === 'n2')).toMatchObject({ archived_at: null, read_at: '2026-11-01T10:00:00Z' })
    expect(table.find((x) => x.id === 'old')!.archived_at).toBe('2026-10-01T00:00:00Z')        // the old archive stays archived
  })

  it('does not un-archive anything archived at another time, nor another person\'s, nor un-read what was read in between', async () => {
    const cleared = await archiveAllNotifications()
    table.find((x) => x.id === 'n1')!.read_at = '2026-11-04T12:00:00Z'                         // the person read it again meanwhile
    // a forged request naming an old archive and another person's notification
    const r = await restoreArchivedNotifications({ archivedAt: cleared.archivedAt!, ids: [...cleared.ids!, 'old', 'theirs'], unreadIds: ['n1', 'n3'] })
    expect(r.restored).toBe(3)
    expect(table.find((x) => x.id === 'old')!.archived_at).toBe('2026-10-01T00:00:00Z')
    expect(table.find((x) => x.id === 'theirs')!.archived_at).toBeNull()
    expect(table.find((x) => x.id === 'n1')!.read_at).toBe('2026-11-04T12:00:00Z')            // stays read
    expect(table.find((x) => x.id === 'n3')!.read_at).toBeNull()
  })

  it('refuses a request that is not a clear-all result', async () => {
    expect((await restoreArchivedNotifications({ archivedAt: 'not a date', ids: ['n1'], unreadIds: [] })).error).toBe('Nothing to undo.')
    expect((await restoreArchivedNotifications({ archivedAt: new Date().toISOString(), ids: [{} as never], unreadIds: [] })).error).toBe('Nothing to undo.')
    expect(await restoreArchivedNotifications({ archivedAt: new Date().toISOString(), ids: [], unreadIds: [] })).toEqual({ restored: 0 })
  })
})
