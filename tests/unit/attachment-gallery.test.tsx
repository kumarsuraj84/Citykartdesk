// @vitest-environment jsdom
/**
 * The attachment preview has Previous / Next arrows (and left/right keys) so a ticket's files can
 * be looked through in one window, across every message of that one ticket.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react'
import { AttachmentChips } from '@/components/requests/AttachmentChips'
import { AttachmentGalleryProvider } from '@/components/requests/AttachmentGallery'
import { orderGalleryItems, type GalleryItem } from '@/lib/attachments/gallery-order'
import type { RequestAttachmentWithUploader } from '@/types'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/actions/attachments', () => ({ deleteAttachment: vi.fn() }))

afterEach(() => cleanup())

const att = (id: string, over: Partial<RequestAttachmentWithUploader> = {}): RequestAttachmentWithUploader =>
  ({
    id, file_name: `${id}.png`, file_size: 2048, mime_type: 'image/png',
    signedUrl: `/api/storage/attachment/request/${id}`, uploaded_by: 'u1', ...over,
  }) as RequestAttachmentWithUploader

const item = (a: RequestAttachmentWithUploader): GalleryItem => ({ id: a.id, file_name: a.file_name, file_size: a.file_size, mime_type: a.mime_type, signedUrl: a.signedUrl })
const row = (list: RequestAttachmentWithUploader[]) => <AttachmentChips attachments={list} currentUserId="u1" canManageAll={false} />
const shown = () => within(screen.getByRole('dialog')).getByRole('img').getAttribute('alt')

describe('preview arrows: one row of files on its own', () => {
  it('a single file shows no arrows and no counter', () => {
    render(row([att('a1')]))
    fireEvent.click(screen.getByText('a1.png'))
    expect(screen.queryByLabelText('Next attachment')).toBeNull()
    expect(screen.queryByLabelText('Previous attachment')).toBeNull()
    expect(screen.queryByText(/ of \d/)).toBeNull()
  })

  it('shows the position and moves forward and back without closing the window', () => {
    render(row([att('a1'), att('a2'), att('a3')]))
    fireEvent.click(screen.getByText('a1.png'))
    expect(screen.getByText(/1 of 3/)).toBeTruthy()
    expect(shown()).toBe('a1.png')
    expect((screen.getByLabelText('Previous attachment') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('Next attachment'))
    expect(screen.getByText(/2 of 3/)).toBeTruthy()
    expect(shown()).toBe('a2.png')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)

    fireEvent.click(screen.getByLabelText('Next attachment'))
    expect(shown()).toBe('a3.png')
    expect((screen.getByLabelText('Next attachment') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('Previous attachment'))
    expect(shown()).toBe('a2.png')
  })

  it('the Download button always belongs to the file being shown', () => {
    render(row([att('a1'), att('a2')]))
    fireEvent.click(screen.getByText('a1.png'))
    fireEvent.click(screen.getByLabelText('Next attachment'))
    const download = screen.getByText('Download').closest('a')!
    expect(download.getAttribute('download')).toBe('a2.png')
    expect(download.getAttribute('href')).toBe('/api/storage/attachment/request/a2')
  })

  it('the left and right arrow keys move between files, and stop at the ends', () => {
    render(row([att('a1'), att('a2')]))
    fireEvent.click(screen.getByText('a1.png'))
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(shown()).toBe('a1.png')
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(shown()).toBe('a2.png')
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(shown()).toBe('a2.png')
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(shown()).toBe('a1.png')
  })

  it('Escape still closes the window', () => {
    render(row([att('a1'), att('a2')]))
    fireEvent.click(screen.getByText('a1.png'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the arrow keys do not flip the file while a video player has focus (they seek there)', () => {
    render(row([att('v1', { file_name: 'clip.mp4', mime_type: 'video/mp4' }), att('a2')]))
    fireEvent.click(screen.getByText('clip.mp4'))
    const video = screen.getByRole('dialog').querySelector('video')!
    fireEvent.keyDown(video, { key: 'ArrowRight' })
    expect(screen.getByRole('dialog').querySelector('video')).not.toBeNull()
  })

  it('moving to the next file starts it afresh (a PDF after an image, a note for a Word file)', () => {
    render(row([att('a1'), att('p1', { file_name: 'bill.pdf', mime_type: 'application/pdf' }), att('d1', { file_name: 'letter.docx', mime_type: 'application/msword' })]))
    fireEvent.click(screen.getByText('a1.png'))
    fireEvent.click(screen.getByLabelText('Next attachment'))
    expect(screen.getByRole('dialog').querySelector('iframe')).not.toBeNull()
    expect(screen.getByRole('dialog').querySelector('img')).toBeNull()
    fireEvent.click(screen.getByLabelText('Next attachment'))
    expect(screen.getByText('No preview for this file type')).toBeTruthy()
  })
})

describe('preview arrows: across the whole ticket', () => {
  const a1 = att('a1'), a2 = att('a2'), b1 = att('b1'), c1 = att('c1')
  const ticket = (
    <AttachmentGalleryProvider items={[a1, a2, b1, c1].map(item)}>
      {row([a1, a2])}
      {row([b1])}
      {row([c1])}
    </AttachmentGalleryProvider>
  )

  it('opens from one message and steps on into the files of the other messages of the same ticket', () => {
    render(ticket)
    fireEvent.click(screen.getByText('a2.png'))
    expect(screen.getByText(/2 of 4/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Next attachment'))
    expect(shown()).toBe('b1.png')
    fireEvent.click(screen.getByLabelText('Next attachment'))
    expect(shown()).toBe('c1.png')
    expect((screen.getByLabelText('Next attachment') as HTMLButtonElement).disabled).toBe(true)
  })

  it('a message with only one file still gets arrows when the ticket has more', () => {
    render(ticket)
    fireEvent.click(screen.getByText('b1.png'))
    expect(screen.getByText(/3 of 4/)).toBeTruthy()
    expect(screen.getByLabelText('Previous attachment')).toBeTruthy()
  })

  it('a file the ticket list does not know falls back to its own row, never to other files', () => {
    const stranger = att('z9')
    render(
      <AttachmentGalleryProvider items={[a1, a2].map(item)}>
        {row([stranger])}
      </AttachmentGalleryProvider>,
    )
    fireEvent.click(screen.getByText('z9.png'))
    expect(shown()).toBe('z9.png')
    expect(screen.queryByLabelText('Next attachment')).toBeNull()
  })

  it('when the page refreshes and the open file is gone from the ticket, the window closes instead of showing another file', () => {
    const { rerender } = render(
      <AttachmentGalleryProvider items={[a1, a2].map(item)}>{row([a1, a2])}</AttachmentGalleryProvider>,
    )
    fireEvent.click(screen.getByText('a2.png'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    rerender(<AttachmentGalleryProvider items={[a1].map(item)}>{row([a1])}</AttachmentGalleryProvider>)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('orderGalleryItems: the order the page shows the files', () => {
  const f = (id: string, comment_id: string | null) => ({ ...item(att(id)), comment_id })

  it('follows the message order, then the original request files', () => {
    const files = [f('x', null), f('c2a', 'c2'), f('c1a', 'c1'), f('c2b', 'c2')]
    expect(orderGalleryItems(files, ['c2', 'c1']).map((i) => i.id)).toEqual(['c2a', 'c2b', 'c1a', 'x'])
  })

  it('keeps files of a message that is not in the list, before the loose ones', () => {
    const files = [f('x', null), f('orphan', 'gone'), f('c1a', 'c1')]
    expect(orderGalleryItems(files, ['c1']).map((i) => i.id)).toEqual(['c1a', 'orphan', 'x'])
  })

  it('hands on only what the preview needs', () => {
    const out = orderGalleryItems([{ ...f('a', null), uploaded_by: 'secret', uploader: { full_name: 'N' } }], [])
    expect(Object.keys(out[0]).sort()).toEqual(['file_name', 'file_size', 'id', 'mime_type', 'signedUrl'])
  })
})
