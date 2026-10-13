// D-012 (recipients / who may send) and D-013 (only known fields can be updated) for scheduled reports.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkReportRecipients } from '@/lib/reporting/report-recipients'

describe('checkReportRecipients', () => {
  const member = (e: string) => ['asha@citykart.org', 'vendor@oem.example'].includes(e)
  it('accepts internal addresses, lower-cases and removes duplicates', () => {
    expect(checkReportRecipients([' Asha@Citykart.org ', 'asha@citykart.org', 'vendor@oem.example'], member)).toEqual({ ok: true, recipients: ['asha@citykart.org', 'vendor@oem.example'] })
  })
  it('rejects an outside address (the original gap)', () => {
    const r = checkReportRecipients(['asha@citykart.org', 'me@external.example'], member)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/not an address of this organisation/)
  })
  it('rejects malformed values and non-lists', () => {
    for (const bad of [['not-an-email'], ['a b@citykart.org'], [''], [null], [{ x: 1 }]]) expect(checkReportRecipients(bad, () => true).ok).toBe(false)
    expect(checkReportRecipients('asha@citykart.org', () => true).ok).toBe(false)
  })
  it('allows at most 20 recipients', () => {
    const many = Array.from({ length: 21 }, (_, i) => `u${i}@citykart.org`)
    expect(checkReportRecipients(many, () => true).ok).toBe(false)
    expect(checkReportRecipients(many.slice(0, 20), () => true).ok).toBe(true)
  })
})

// ── the actions ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let currentProfile: { id: string; role: string; org_id: string } | null = null
const writes: { op: string; values?: Record<string, unknown> }[] = []
const sent: string[] = []

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => currentProfile }))
vi.mock('@/lib/requests/cc-recipients', () => ({ loadCcBook: async () => new Map([['asha@citykart.org', {}], ['ravi@citykart.org', {}]]) }))
vi.mock('@/lib/email/send', () => ({ sendEmail: async ({ to }: { to: string }) => { sent.push(to); return {} } }))
vi.mock('@/lib/export/reports', () => ({ exportRequestsCSV: async () => 'a,b', exportTasksCSV: async () => 'a', exportApprovalsCSV: async () => 'a' }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    const q: Record<string, unknown> = {
      select: () => q,
      insert: (values: Record<string, unknown>) => { writes.push({ op: 'insert', values }); return q },
      update: (values: Record<string, unknown>) => { writes.push({ op: 'update', values }); return q },
      delete: () => { writes.push({ op: 'delete' }); return q },
      eq: () => q,
      single: async () => ({ data: { id: 'new-id' }, error: null }),
      maybeSingle: async () => ({ data: { id: 'r1', org_id: 'org', name: 'Weekly', report_type: 'requests', frequency: 'weekly', recipients: ['asha@citykart.org', 'me@external.example'], filters: {} }, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ error: null }),
    }
    return { from: () => q }
  },
}))

const base = { name: 'Weekly', report_type: 'requests' as const, frequency: 'weekly' as const, filters: {}, is_active: true }

describe('scheduled report actions', () => {
  beforeEach(() => { writes.length = 0; sent.length = 0; currentProfile = { id: 'adm', role: 'admin', org_id: 'org' } })

  it('a manager can no longer create, change, delete or send a scheduled report (it carries organization-wide data)', async () => {
    currentProfile = { id: 'm', role: 'manager', org_id: 'org' }
    const a = await import('@/lib/actions/admin/reports')
    expect((await a.createScheduledReport({ ...base, recipients: ['asha@citykart.org'] })).error).toBe('Unauthorized.')
    expect((await a.updateScheduledReport('r1', { name: 'x' })).error).toBe('Unauthorized.')
    expect((await a.deleteScheduledReport('r1')).error).toBe('Unauthorized.')
    expect((await a.sendScheduledReport('r1')).error).toBe('Unauthorized.')
    expect(writes).toEqual([])
    expect(sent).toEqual([])
  })

  it('an admin cannot save a report addressed outside the organization', async () => {
    const a = await import('@/lib/actions/admin/reports')
    const r = await a.createScheduledReport({ ...base, recipients: ['me@external.example'] })
    expect(r.error).toMatch(/not an address of this organisation/)
    expect(writes).toEqual([])
  })

  it('an admin can save and update a report addressed to the organization', async () => {
    const a = await import('@/lib/actions/admin/reports')
    expect((await a.createScheduledReport({ ...base, recipients: ['Asha@citykart.org'] })).data?.id).toBe('new-id')
    expect(writes[0].values).toMatchObject({ recipients: ['asha@citykart.org'], org_id: 'org', created_by: 'adm' })
    expect((await a.updateScheduledReport('r1', { recipients: ['ravi@citykart.org'] })).error).toBeUndefined()
  })

  it('update ignores any field that is not one of the report\'s own settings (the original mass-assignment gap)', async () => {
    const a = await import('@/lib/actions/admin/reports')
    const forged = { name: 'New name', org_id: 'other-org', created_by: 'someone-else', last_sent_at: '2000-01-01', id: 'x' } as never
    expect((await a.updateScheduledReport('r1', forged)).error).toBeUndefined()
    expect(writes).toHaveLength(1)
    expect(writes[0].values).toEqual({ name: 'New name' })
  })

  it('update refuses an unknown report type or frequency', async () => {
    const a = await import('@/lib/actions/admin/reports')
    expect((await a.updateScheduledReport('r1', { report_type: 'users' as never })).error).toBe('Unknown report type.')
    expect((await a.updateScheduledReport('r1', { frequency: 'hourly' as never })).error).toBe('Unknown frequency.')
    expect(writes).toEqual([])
  })

  it('sending re-checks the stored recipients: an outside address saved earlier is never used', async () => {
    const a = await import('@/lib/actions/admin/reports')
    const r = await a.sendScheduledReport('r1')
    expect(r.error).toMatch(/not an address of this organisation/)
    expect(sent).toEqual([])
  })
})
