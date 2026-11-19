import { describe, it, expect } from 'vitest'
import { safeStorageName } from '@/lib/attachments/safe-name'

// The database refuses a storage path that contains ".."; a normal file name with two dots must still upload.
describe('safeStorageName', () => {
  it.each([
    ['photo..jpg', 'photo.jpg'],
    ['scan ..pdf', 'scan_.pdf'],
    ['IMG-2026...jpeg', 'IMG-2026.jpeg'],
    ['report.final.pdf', 'report.final.pdf'],
    ['WhatsApp Image 2026-11-18 at 3.45.21 PM (1).jpeg', 'WhatsApp_Image_2026-11-18_at_3.45.21_PM_1_.jpeg'],
    ['.hidden', 'hidden'],
    ['..', 'file'],
    ['', 'file'],
  ])('%s -> %s', (input, expected) => expect(safeStorageName(input)).toBe(expected))

  it('never leaves ".." in the result, whatever the name', () => {
    for (const n of ['a..b', '../../etc/passwd', 'x . . y', 'name.', '....', 'a._.b..c...d']) expect(safeStorageName(n)).not.toContain('..')
  })

  it('cuts a very long name', () => {
    expect(safeStorageName('x'.repeat(500) + '.pdf').length).toBe(200)
  })
})
