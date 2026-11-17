// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ usePathname: () => '/requests', useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }) }))
vi.mock('@/lib/actions/requests', () => ({ addComment: vi.fn(async () => ({ commentId: 'c1' })), deleteEmptyComment: vi.fn() }))
vi.mock('@/lib/actions/attachments', () => ({ uploadAttachment: vi.fn(async () => ({})) }))
vi.mock('@/lib/actions/ticketCopy', () => ({ copyCommentByEmail: vi.fn(), searchCcContacts: vi.fn(async () => []) }))
vi.mock('@/lib/attachments/validate', () => ({ validateAttachment: vi.fn(async () => ({ valid: true })) }))
import { CommentForm } from '@/components/requests/CommentForm'

afterEach(cleanup)
const open = () => { render(<div><CommentForm requestId="r1" canPostInternal={false} /><p>outside the form</p></div>); fireEvent.click(screen.getByText('Templates')) }

describe('Templates list in the conversation box (owner request 2026-11-16)', () => {
  it('closes when the person clicks anywhere outside it', () => {
    open(); expect(screen.getByPlaceholderText('Search templates…')).toBeTruthy()
    fireEvent.pointerDown(screen.getByText('outside the form'))
    expect(screen.queryByPlaceholderText('Search templates…')).toBeNull()
  })
  it('closes with Escape', () => {
    open(); fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByPlaceholderText('Search templates…')).toBeNull()
  })
  it('stays open when the person clicks inside it (the search box)', () => {
    open(); fireEvent.pointerDown(screen.getByPlaceholderText('Search templates…')); expect(screen.getByPlaceholderText('Search templates…')).toBeTruthy()
  })
  it('still closes by clicking the Templates button again', () => {
    open(); fireEvent.click(screen.getByText('Templates')); expect(screen.queryByPlaceholderText('Search templates…')).toBeNull()
  })
})

describe('Paste a copied file into the conversation box (owner request 2026-11-16)', () => {
  const paste = (box: HTMLElement, files: File[], text = '') => fireEvent.paste(box, { clipboardData: { files, getData: (t: string) => (t === 'text/plain' ? text : '') } })
  it('a pasted file is attached and listed, like the Attach button', async () => {
    render(<CommentForm requestId="r1" canPostInternal={false} />)
    paste(screen.getByLabelText('Public comment'), [new File(['x'], 'invoice.pdf', { type: 'application/pdf' })])
    await waitFor(() => expect(screen.getByText('invoice.pdf')).toBeTruthy())
  })
  it('pasted text is left alone (nothing attached)', async () => {
    render(<CommentForm requestId="r1" canPostInternal={false} />)
    paste(screen.getByLabelText('Public comment'), [], 'just words'); await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByLabelText(/^Remove /)).toBeNull()
  })
  it('a dropped file is attached', async () => {
    render(<CommentForm requestId="r1" canPostInternal={false} />)
    fireEvent.drop(screen.getByLabelText('Public comment'), { dataTransfer: { files: [new File(['x'], 'photo.png', { type: 'image/png' })], getData: () => '', types: ['Files'] } })
    await waitFor(() => expect(screen.getByText('photo.png')).toBeTruthy())
  })
})
