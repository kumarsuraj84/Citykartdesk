// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// What the approver sees with the approval: the technician's remarks and the files he sent along.
vi.mock('@/lib/actions/approvals', () => ({ approveApproval: vi.fn(), rejectApproval: vi.fn(), delegateApproval: vi.fn(), recallApproval: vi.fn(), searchUsersForDelegation: vi.fn() }))
vi.mock('@/lib/actions/attachments', () => ({ deleteAttachment: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { ApprovalPanel } from '@/components/requests/ApprovalPanel'

afterEach(() => cleanup())

const approval = {
  id: 'ap-1', request_id: 'req-1', workflow_id: 'wf-1', current_step: 0, status: 'pending', created_at: '2026-11-19T10:00:00Z', updated_at: '2026-11-19T10:00:00Z', requested_by: 'tech-1',
  request: { id: 'req-1', request_no: 'CKSD-001261', title: 'SHARE DRIVE RIGHTS', requester_id: 'u-1', priority: 'high', status: 'pending_approval', created_at: '2026-11-19T09:00:00Z', requester: { id: 'u-1', full_name: 'Ritika Lunawat' }, service: null, team: null },
  workflow: { id: 'wf-1', name: 'Ad-hoc approval CKSD-001261' },
  steps: [{ id: 's1', workflow_id: 'wf-1', step_order: 1, approver_type: 'specific_user', approver_user_id: 'appr-1', approver: { id: 'appr-1', full_name: 'Raahul Vohra' } }],
  decisions: [],
} as never

const file = { id: 'f1', file_name: 'quote.pdf', file_size: 52000, mime_type: 'application/pdf', signedUrl: '/api/storage/attachment/request/f1', comment_id: 'c1', uploaded_by: 'tech-1', uploader: { id: 'tech-1', full_name: 'Ajay Kumar' }, uploaded_at: '2026-11-19T10:00:05Z' } as never

describe('the approval screen shows what the technician sent with it', () => {
  it('remarks and files are shown above the approvers', () => {
    render(<ApprovalPanel approval={approval} viewerId="appr-1" viewerRole="user" senderNote={{ senderName: 'Ajay Kumar', at: '2026-11-19T10:00:01Z', text: 'Quote attached. Please approve by Friday.', files: [file] }} />)
    const box = screen.getByLabelText('Remarks from the technician')
    expect(box.textContent).toContain('Remarks from Ajay Kumar')
    expect(box.textContent).toContain('Quote attached. Please approve by Friday.')
    expect(box.textContent).toContain('quote.pdf')
  })

  it('files without remarks are still shown', () => {
    render(<ApprovalPanel approval={approval} viewerId="appr-1" viewerRole="user" senderNote={{ senderName: 'Ajay Kumar', at: '2026-11-19T10:00:01Z', text: '', files: [file] }} />)
    expect(screen.getByLabelText('Remarks from the technician').textContent).toContain('quote.pdf')
  })

  it('nothing extra is drawn when the technician added nothing', () => {
    render(<ApprovalPanel approval={approval} viewerId="appr-1" viewerRole="user" senderNote={null} />)
    expect(screen.queryByLabelText('Remarks from the technician')).toBeNull()
    cleanup()
    render(<ApprovalPanel approval={approval} viewerId="appr-1" viewerRole="user" senderNote={{ senderName: 'Ajay Kumar', at: '2026-11-19T10:00:01Z', text: '', files: [] }} />)
    expect(screen.queryByLabelText('Remarks from the technician')).toBeNull()
  })
})
