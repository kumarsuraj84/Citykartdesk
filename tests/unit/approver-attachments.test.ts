import { describe, it, expect, vi, beforeEach } from 'vitest'

// An approver who is not on the ticket's group and not a manager may open the PUBLIC files of the ticket they are asked to approve (what the technician sent with the approval);
// nobody else gains anything, and an internal or deleted file is never given.
let isApprover = false
let rows: Record<string, unknown>[] = []
const filters: string[] = []

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: async () => ({ data: isApprover }), from: () => ({}) }) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'order']) chain[m] = (...a: unknown[]) => { filters.push(`${m}:${a.join('=')}`); return chain }
      chain.maybeSingle = async () => ({ data: rows[0] ?? null })
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows }).then(res)
      return chain
    },
  }),
}))

import { getApproverAttachments, getApproverAttachmentRow } from '@/lib/queries/attachments'

beforeEach(() => { isApprover = false; rows = [{ id: 'f1', request_id: 'req-1', file_name: 'quote.pdf' }]; filters.length = 0 })

describe('files for an approver of the ticket', () => {
  it('a person who is not an approver of the ticket gets nothing', async () => {
    expect(await getApproverAttachments('req-1')).toEqual([])
    expect(await getApproverAttachmentRow('f1')).toBeNull()
  })

  it('an approver gets the public files of the ticket, each with the checked download address', async () => {
    isApprover = true
    const files = await getApproverAttachments('req-1')
    expect(files).toHaveLength(1)
    expect(files[0].signedUrl).toBe('/api/storage/attachment/request/f1')
    expect(filters).toContain('eq:is_internal=false')          // internal files are never given
    expect(filters).toContain('is:deleted_at=')            // deleted files neither
  })

  it('a single file is given to an approver of its ticket, and only a public, not deleted one', async () => {
    isApprover = true
    expect(await getApproverAttachmentRow('f1')).toMatchObject({ id: 'f1' })
    expect(filters).toContain('eq:is_internal=false')
    expect(filters).toContain('is:deleted_at=')
    rows = []
    expect(await getApproverAttachmentRow('nope')).toBeNull()
  })
})
