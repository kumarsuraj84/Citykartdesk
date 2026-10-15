// VAPT VA-API-06 / VA-INT-04: a spreadsheet whose zip directory LIES about its size must not be unpacked without a limit.
import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { previewXlsx, PreviewError, MAX_UNCOMPRESSED_BYTES } from '@/lib/attachments/xlsx-preview'

/** A one-entry zip whose directory declares `declared` bytes while the entry really holds `real` bytes of zeros. */
function zipThatLies(real: number, declared: number): Buffer {
  const data = deflateRawSync(Buffer.alloc(real))
  const name = Buffer.from('xl/sharedStrings.xml')
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(declared, 22); local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10)
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(declared, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42)
  const body = Buffer.concat([local, name, data])
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(body.length, 16)
  return Buffer.concat([body, central, name, eocd])
}

describe('xlsx preview: the real unpacked size is checked, not the size the file claims', () => {
  it('refuses a file that declares 1 KB but unpacks past the limit', async () => {
    const bomb = zipThatLies(MAX_UNCOMPRESSED_BYTES + 5 * 1024 * 1024, 1024)
    expect(bomb.length).toBeLessThan(1024 * 1024)                              // tiny on the wire
    await expect(previewXlsx(bomb)).rejects.toMatchObject({ code: 'too_large' })
    await expect(previewXlsx(bomb)).rejects.toBeInstanceOf(PreviewError)
  })
  it('does not call a small honest zip too large (it fails later as unreadable: it is not a real workbook)', async () => {
    const small = zipThatLies(2048, 2048)
    await expect(previewXlsx(small)).rejects.toMatchObject({ code: 'unreadable' })
  })
})
