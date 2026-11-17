import { describe, expect, it } from 'vitest'
import { filesToAttachFromTransfer } from '@/lib/attachments/paste'

// Owner request 2026-11-16: in a ticket conversation, copy a file (or take a screenshot) and press Ctrl+V: it must be attached like the Attach button does.
// Plain text must still paste as text, and a copy from Excel/Word (text + a picture of it) must paste as text, not as an attached picture.
const file = (name: string, type = 'application/pdf') => new File(['x'], name, { type })
const transfer = (files: File[], text = '') => ({ files, getData: (t: string) => (t === 'text/plain' ? text : '') })

describe('files taken from a paste or a drop', () => {
  it('a copied file (no text) is attached', () => {
    const f = file('quote.pdf'); expect(filesToAttachFromTransfer(transfer([f]))).toEqual([f])
  })
  it('several copied files are all attached', () => {
    const a = file('a.pdf'), b = file('b.xlsx'); expect(filesToAttachFromTransfer(transfer([a, b]))).toHaveLength(2)
  })
  it('a screenshot from the clipboard gets a readable, unique name', () => {
    const shot = file('image.png', 'image/png'); const out = filesToAttachFromTransfer(transfer([shot]), new Date('2026-11-16T10:42:33'))
    expect(out).toHaveLength(1); expect(out[0].name).toMatch(/^screenshot-20261116-104233\.png$/); expect(out[0].type).toBe('image/png')
  })
  it('plain text is not treated as a file', () => {
    expect(filesToAttachFromTransfer(transfer([], 'hello'))).toEqual([])
  })
  it('a copy from a spreadsheet or document (text plus a picture) is pasted as text', () => {
    expect(filesToAttachFromTransfer(transfer([file('image.png', 'image/png')], 'A1\tB1'))).toEqual([])
  })
  it('nothing in the clipboard gives nothing', () => {
    expect(filesToAttachFromTransfer(null)).toEqual([])
    expect(filesToAttachFromTransfer(transfer([]))).toEqual([])
  })
})
