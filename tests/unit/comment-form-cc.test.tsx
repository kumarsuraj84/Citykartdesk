// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const addComment = vi.hoisted(() => vi.fn(async () => ({ commentId: 'c-new' })))
const copyComment = vi.hoisted(() => vi.fn(async (): Promise<{ error?: string; sent: { email: string; name: string }[]; failed: { email: string; reason: string }[]; pdfAttached?: boolean }> => ({ sent: [{ email: 'asha@citykart.org', name: 'Asha Mehta' }], failed: [], pdfAttached: true })))
const search = vi.hoisted(() => vi.fn(async (q: string) => {
  const all = [
    { email: 'asha@citykart.org', name: 'Asha Mehta', kind: 'user' as const, detail: 'Manager' },
    { email: 'service@daikin.test', name: 'DAIKIN', kind: 'oem' as const, detail: 'OEM contact' },
  ]
  return all.filter((c) => c.email.includes(q.toLowerCase()) || c.name.toLowerCase().includes(q.toLowerCase()))
}))
vi.mock('@/lib/actions/requests', () => ({ addComment, deleteEmptyComment: vi.fn() }))
vi.mock('@/lib/actions/attachments', () => ({ uploadAttachment: vi.fn(async () => ({})) }))
vi.mock('@/lib/actions/ticketCopy', () => ({ copyCommentByEmail: copyComment, searchCcContacts: search }))
vi.mock('@/lib/attachments/validate', () => ({ validateAttachment: vi.fn(async () => ({ valid: true })) }))

import { CommentForm } from '@/components/requests/CommentForm'

afterEach(() => cleanup())
beforeEach(() => { addComment.mockClear(); copyComment.mockClear() })

const typeComment = (text: string) => fireEvent.change(screen.getByPlaceholderText(/Add a public comment/), { target: { value: text } })
const openCc = () => fireEvent.click(screen.getByRole('button', { name: /^CC/ }))

describe('CC on the comment form', () => {
  it('is only offered to technicians, and not for an internal note', () => {
    const { unmount } = render(<CommentForm requestId="r1" canPostInternal={false} />)
    expect(screen.queryByRole('button', { name: /^CC/ })).toBeNull()
    unmount()
    render(<CommentForm requestId="r1" canPostInternal />)
    expect(screen.getByRole('button', { name: /^CC/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Internal note/ }))
    expect(screen.queryByRole('button', { name: /^CC/ })).toBeNull()
  })

  it('suggests CK Desk people, posts the comment, then copies it with the PDF and says who got it', async () => {
    render(<CommentForm requestId="r1" canPostInternal />)
    openCc()
    fireEvent.change(screen.getByLabelText('CC e-mail'), { target: { value: 'ash' } })
    fireEvent.click(await screen.findByText(/Asha Mehta/))
    expect(screen.getByText('Asha Mehta')).toBeTruthy() // the chip
    typeComment('Card will be issued tomorrow')
    fireEvent.click(screen.getByRole('button', { name: /Post/ }))
    await waitFor(() => expect(copyComment).toHaveBeenCalledWith('r1', 'c-new', ['asha@citykart.org'], true))
    expect(await screen.findByText(/Copied by e-mail to Asha Mehta \(PDF attached\)/)).toBeTruthy()
    expect(addComment).toHaveBeenCalledWith('r1', 'Card will be issued tomorrow', false, false)
  })

  it('passes the PDF choice on', async () => {
    render(<CommentForm requestId="r1" canPostInternal />)
    openCc()
    fireEvent.change(screen.getByLabelText('CC e-mail'), { target: { value: 'ash' } })
    fireEvent.click(await screen.findByText(/Asha Mehta/))
    fireEvent.click(screen.getByLabelText('Attach ticket PDF'))
    typeComment('Update')
    fireEvent.click(screen.getByRole('button', { name: /Post/ }))
    await waitFor(() => expect(copyComment).toHaveBeenCalledWith('r1', 'c-new', ['asha@citykart.org'], false))
  })

  it('shows a typed address that is not a CK Desk address in red and refuses to post until it is removed', async () => {
    render(<CommentForm requestId="r1" canPostInternal />)
    openCc()
    const box = screen.getByLabelText('CC e-mail')
    fireEvent.change(box, { target: { value: 'outsider@gmail.com' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/Not a CK Desk address/)).toBeTruthy()
    typeComment('Hello')
    fireEvent.click(screen.getByRole('button', { name: /Post/ }))
    expect(await screen.findByText(/Remove the CC addresses marked in red/)).toBeTruthy()
    expect(addComment).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Remove outsider@gmail.com'))
    fireEvent.click(screen.getByRole('button', { name: /Post/ }))
    await waitFor(() => expect(addComment).toHaveBeenCalled())
    expect(copyComment).not.toHaveBeenCalled()
  })

  it('tells the technician when a copy could not be sent, while the comment is still posted', async () => {
    copyComment.mockResolvedValueOnce({ sent: [], failed: [{ email: 'asha@citykart.org', reason: 'Could not be sent.' }], error: 'Could not be sent.' })
    render(<CommentForm requestId="r1" canPostInternal />)
    openCc()
    fireEvent.change(screen.getByLabelText('CC e-mail'), { target: { value: 'ash' } })
    fireEvent.click(await screen.findByText(/Asha Mehta/))
    typeComment('Hello')
    fireEvent.click(screen.getByRole('button', { name: /Post/ }))
    expect(await screen.findByText(/Comment posted, but the copy was not sent/)).toBeTruthy()
  })
})
