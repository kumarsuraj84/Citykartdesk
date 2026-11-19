import { describe, it, expect } from 'vitest'
import { approvalNoteBody, approvalNoteText, findApprovalNote, isApprovalNote, approvalNotifyBody, APPROVAL_NOTE_MARKER } from '@/lib/approvals/note'

describe('the remarks that go with "Send for approval"', () => {
  it('writes the marker line with the approvers, then the remarks', () => {
    const b = approvalNoteBody({ approverNames: ['Raahul Vohra', 'Banking'], remarks: '  Quote attached, please approve by Friday.  ' })
    expect(b).toBe(`${APPROVAL_NOTE_MARKER} to Raahul Vohra, Banking\nQuote attached, please approve by Friday.`)
    expect(approvalNoteText(b)).toBe('Quote attached, please approve by Friday.')
    expect(isApprovalNote(b)).toBe(true)
  })

  it('files without remarks still make a readable message', () => {
    expect(approvalNoteBody({ approverNames: ['A'], fileCount: 1 })).toMatch(/\(a file is attached for you to review\)/)
    expect(approvalNoteBody({ approverNames: ['A'], fileCount: 3 })).toMatch(/\(3 files are attached/)
  })

  it('an ordinary message is not a note', () => {
    expect(isApprovalNote('We are working on it')).toBe(false)
    expect(isApprovalNote(null)).toBe(false)
  })

  const approval = { created_at: '2026-11-19T10:00:00Z', requested_by: 'tech' }
  const note = (id: string, at: string, author = 'tech', body = `${APPROVAL_NOTE_MARKER} to X\nremark`) => ({ id, body, created_at: at, author_id: author })

  it('finds the note written with this approval, by marker, sender and time', () => {
    const list = [note('late', '2026-11-19T12:00:00Z'), note('mine', '2026-11-19T10:00:02Z'), note('other-person', '2026-11-19T10:00:01Z', 'someone'), { id: 'x', body: 'hello', created_at: '2026-11-19T10:00:00Z', author_id: 'tech' }]
    expect(findApprovalNote(approval, list)?.id).toBe('mine')
  })

  it('two rounds of approval each get their own note', () => {
    const list = [note('round1', '2026-11-18T09:00:00Z'), note('round2', '2026-11-19T10:00:03Z')]
    expect(findApprovalNote({ created_at: '2026-11-18T09:00:01Z', requested_by: 'tech' }, list)?.id).toBe('round1')
    expect(findApprovalNote(approval, list)?.id).toBe('round2')
  })

  it('no note when none was written (an approval sent without remarks or files)', () => {
    expect(findApprovalNote(approval, [])).toBeNull()
    expect(findApprovalNote(approval, [note('far', '2026-11-19T10:30:00Z')])).toBeNull()
  })

  it('the approver\'s notification carries the remarks and the number of files', () => {
    const t = approvalNotifyBody('SHARE DRIVE RIGHTS', 'Ajay Kumar', 'Please approve', 2)
    expect(t).toContain('"SHARE DRIVE RIGHTS" has been sent to you for approval.')
    expect(t).toContain('Remarks from Ajay Kumar: Please approve')
    expect(t).toContain('2 files are attached')
    expect(approvalNotifyBody('T', 'A', '', 0)).toBe('"T" has been sent to you for approval.')
    expect(approvalNotifyBody('T', 'A', 'x'.repeat(400), 1)).toContain('…')
  })
})
