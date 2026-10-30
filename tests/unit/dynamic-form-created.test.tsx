// @vitest-environment jsdom
/**
 * E-02 / E-21: after the ticket is created the form is replaced by a "Request created" screen that sends the files one by one,
 * lets a failed file be retried, and never lets a failed call escape as an unhandled error. A call that never answered says so
 * without inviting a second ticket.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, refresh: vi.fn() }), usePathname: () => '/services/printer' }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))

const createRequest = vi.hoisted(() => vi.fn())
const uploadAttachment = vi.hoisted(() => vi.fn())
const confirmRequiredFiles = vi.hoisted(() => vi.fn())
vi.mock('@/lib/actions/requests', () => ({ createRequest, searchOrgMembers: vi.fn(async () => []) }))
vi.mock('@/lib/actions/attachments', () => ({ uploadAttachment, confirmRequiredFiles }))
vi.mock('@/lib/attachments/validate', () => ({ validateAttachment: vi.fn(async () => ({ valid: true })) }))

import { DynamicForm } from '@/components/forms/DynamicForm'
import type { ServiceWithRelations } from '@/types'

const service = {
  id: 's1', name: 'Printer', template: null,
  form_sections: [{ id: 'sec1', title: '', order: 0, fields: [{ id: 'f1', type: 'file', label: 'Photos', order: 0, required: false }] }],
} as unknown as ServiceWithRelations

function renderForm() {
  return render(<DynamicForm service={service} allowedSubCategories={[]} />)
}

function addFile(name: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['x'], name, { type: 'image/png' })
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => { createRequest.mockReset(); uploadAttachment.mockReset(); confirmRequiredFiles.mockReset(); confirmRequiredFiles.mockResolvedValue({ missing: [] }); nav.push.mockClear() })
afterEach(() => cleanup())

describe('DynamicForm after submit (E-02, E-21)', () => {
  it('a createRequest call that never answers shows a plain message and keeps the form', async () => {
    createRequest.mockRejectedValueOnce(new Error('Failed to fetch'))
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: /Submit Request/ }))
    expect(await screen.findByText(/could not confirm that your request was sent/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Submit Request/ })).toBeTruthy()
  })

  it('an answer with neither an error nor a ticket is reported, not ignored', async () => {
    createRequest.mockResolvedValueOnce({})
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: /Submit Request/ }))
    expect(await screen.findByText(/could not confirm that your request was created/i)).toBeTruthy()
  })

  it('when a file fails the ticket stays created, the failed file can be retried, and success opens the ticket', async () => {
    createRequest.mockResolvedValueOnce({ requestId: 'r-1' })
    uploadAttachment.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ attachmentId: 'a1' })
    renderForm()
    addFile('photo.png')
    await screen.findByText('photo.png')
    fireEvent.click(screen.getByRole('button', { name: /Submit Request/ }))

    expect(await screen.findByText('Request created')).toBeTruthy()
    expect(await screen.findByText(/Could not upload/)).toBeTruthy()
    // the form (and its submit button) is gone, so the same ticket cannot be created twice from here
    expect(screen.queryByRole('button', { name: /Submit Request/ })).toBeNull()
    expect(createRequest).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Try the failed files again' }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/requests/r-1'))
    expect(uploadAttachment).toHaveBeenCalledTimes(2)
    expect(createRequest).toHaveBeenCalledTimes(1)
  })

  it('shows the ticket number next to "Request created" when the server returns it', async () => {
    createRequest.mockResolvedValueOnce({ requestId: 'r-2', requestNo: 'CKSD-9' })
    uploadAttachment.mockResolvedValue({ attachmentId: 'a1' })
    renderForm()
    addFile('photo.png')
    await screen.findByText('photo.png')
    fireEvent.click(screen.getByRole('button', { name: /Submit Request/ }))
    expect(await screen.findByText('Request created (CKSD-9)')).toBeTruthy()
  })

  it('B-16: when every file fails and the form needed one, the screen says a required file is missing and keeps the retry button (no automatic move on)', async () => {
    createRequest.mockResolvedValueOnce({ requestId: 'r-3' })
    uploadAttachment.mockRejectedValueOnce(new Error('network'))
    confirmRequiredFiles.mockResolvedValueOnce({ missing: ['Photos'] })
    renderForm()
    addFile('photo.png')
    await screen.findByText('photo.png')
    fireEvent.click(screen.getByRole('button', { name: /Submit Request/ }))
    expect(await screen.findByText(/A required file is still missing \(Photos\)/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try the failed files again' })).toBeTruthy()
    expect(nav.push).not.toHaveBeenCalled()
    expect(confirmRequiredFiles).toHaveBeenCalledWith('r-3')
  })

  it('B-16: a ticket sent with no file although the form asked for one stays on the "Request created" screen with the message', async () => {
    createRequest.mockResolvedValueOnce({ requestId: 'r-4', requestNo: 'CKSD-10' })
    confirmRequiredFiles.mockResolvedValueOnce({ missing: ['Photos'] })
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: /Submit Request/ }))
    expect(await screen.findByText(/A required file is still missing/)).toBeTruthy()
    expect(nav.push).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Open the request' })).toBeTruthy()
  })

  it('with nothing missing and no files the person goes straight to the ticket, as before', async () => {
    createRequest.mockResolvedValueOnce({ requestId: 'r-5' })
    renderForm()
    fireEvent.click(screen.getByRole('button', { name: /Submit Request/ }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/requests/r-5'))
  })
})
