// @vitest-environment jsdom
/**
 * Clicking an attachment used to force a download (an <a download> link). It now opens a
 * preview popup; downloading only happens from the popup's Download button.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AttachmentChips } from '@/components/requests/AttachmentChips'
import { previewKind } from '@/components/requests/AttachmentPreviewModal'
import type { RequestAttachmentWithUploader } from '@/types'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/actions/attachments', () => ({ deleteAttachment: vi.fn() }))

afterEach(() => cleanup())

const att = (over: Partial<RequestAttachmentWithUploader>): RequestAttachmentWithUploader =>
  ({
    id: 'a1', file_name: 'screenshot.png', file_size: 2048, mime_type: 'image/png',
    signedUrl: '/api/storage/attachment/request/a1', uploaded_by: 'u1', ...over,
  }) as RequestAttachmentWithUploader

function renderChips(attachments: RequestAttachmentWithUploader[]) {
  return render(<AttachmentChips attachments={attachments} currentUserId="u1" canManageAll={false} />)
}

describe('previewKind', () => {
  it.each([
    ['image/png', 100, 'image'], ['image/jpeg', 100, 'image'], ['application/pdf', 100, 'pdf'],
    ['video/mp4', 100, 'video'], ['audio/mpeg', 100, 'audio'], ['text/plain', 100, 'text'],
    ['text/csv', 100, 'text'], ['text/plain', 5 * 1024 * 1024, 'none'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 100, 'sheet'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 6 * 1024 * 1024, 'none'],
    ['application/vnd.ms-excel', 100, 'none'],
    ['application/msword', 100, 'none'], ['application/zip', 100, 'none'],
  ])('%s (%i bytes) -> %s', (mime, size, expected) => {
    expect(previewKind(mime, size)).toBe(expected)
  })
})

describe('AttachmentChips — preview instead of auto-download', () => {
  it('the attachment itself is no longer a download link', () => {
    renderChips([att({})])
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('clicking an image opens a preview popup, with a separate Download button', () => {
    renderChips([att({})])
    fireEvent.click(screen.getByText('screenshot.png'))
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('/api/storage/attachment/request/a1')
    const download = screen.getByText('Download').closest('a')!
    expect(download.getAttribute('download')).toBe('screenshot.png')
    expect(download.getAttribute('href')).toBe('/api/storage/attachment/request/a1')
  })

  it('a PDF previews in a frame', () => {
    renderChips([att({ file_name: 'bill.pdf', mime_type: 'application/pdf' })])
    fireEvent.click(screen.getByText('bill.pdf'))
    expect(screen.getByRole('dialog').querySelector('iframe')).not.toBeNull()
  })

  it('a file with no browser preview says so and still offers Download', () => {
    renderChips([att({ file_name: 'letter.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })])
    fireEvent.click(screen.getByText('letter.docx'))
    expect(screen.getByText('No preview for this file type')).toBeTruthy()
    expect(screen.getByText('Download').closest('a')?.getAttribute('download')).toBe('letter.docx')
  })

  it('closes with the X button, the Escape key and a backdrop click', () => {
    renderChips([att({})])
    fireEvent.click(screen.getByText('screenshot.png'))
    fireEvent.click(screen.getByLabelText('Close preview'))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByText('screenshot.png'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByText('screenshot.png'))
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not close when clicking inside the popup', () => {
    renderChips([att({})])
    fireEvent.click(screen.getByText('screenshot.png'))
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  describe('Excel (.xlsx) files', () => {
    const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const sheetAtt = () => att({ file_name: 'stock.xlsx', mime_type: XLSX, file_size: 4096, signedUrl: '/api/storage/attachment/request/x1' })

    function mockPreview(body: unknown, ok = true) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => body }))
    }

    it('shows the workbook as a table with Excel-style column letters and row numbers', async () => {
      mockPreview({
        sheetsTruncated: false,
        sheets: [
          { name: 'Stock', rows: [['Item', 'Qty'], ['Router', '12']], totalRows: 2, totalCols: 2, truncated: false },
          { name: 'Notes', rows: [['hello']], totalRows: 1, totalCols: 1, truncated: false },
        ],
      })
      renderChips([sheetAtt()])
      fireEvent.click(screen.getByText('stock.xlsx'))
      await waitFor(() => expect(screen.getByText('Router')).toBeTruthy())
      expect(screen.getByText('A')).toBeTruthy()
      expect(screen.getByText('B')).toBeTruthy()
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/api/storage/attachment/request/x1/preview')
      expect(screen.getByText('Download').closest('a')?.getAttribute('download')).toBe('stock.xlsx')

      fireEvent.click(screen.getByText('Notes'))
      expect(screen.getByText('hello')).toBeTruthy()
    })

    it('says when only the first rows are shown', async () => {
      mockPreview({
        sheetsTruncated: false,
        sheets: [{ name: 'Big', rows: [['a']], totalRows: 1240, totalCols: 1, truncated: true }],
      })
      renderChips([sheetAtt()])
      fireEvent.click(screen.getByText('stock.xlsx'))
      await waitFor(() => expect(screen.getByText(/Showing the first 1 of 1240 rows/)).toBeTruthy())
    })

    it('shows a clear message when the file is too large or unreadable, and keeps Download', async () => {
      mockPreview({ error: 'too_large' }, false)
      renderChips([sheetAtt()])
      fireEvent.click(screen.getByText('stock.xlsx'))
      await waitFor(() => expect(screen.getByText('This spreadsheet is too large to preview')).toBeTruthy())
      expect(screen.getByText('Download')).toBeTruthy()
    })

    it('shows the unreadable message when the preview request fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
      renderChips([sheetAtt()])
      fireEvent.click(screen.getByText('stock.xlsx'))
      await waitFor(() => expect(screen.getByText("Couldn't preview this spreadsheet")).toBeTruthy())
    })
  })
})
