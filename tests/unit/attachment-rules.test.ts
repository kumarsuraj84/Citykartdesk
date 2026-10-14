import { describe, it, expect } from 'vitest'
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_SET, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES, contentMatchesDeclaredType, validateAttachment } from '@/lib/attachments/validate'

const bytes = (...b: number[]) => Uint8Array.from(b)
const file = (name: string, type: string, content: number[]) => new File([Uint8Array.from(content)], name, { type })

describe('one set of upload rules for every upload path (D-055)', () => {
  it('SVG and scripts are never allowed, in any list', () => {
    expect(ALLOWED_MIME_SET.has('image/svg+xml')).toBe(false)
    expect(ALLOWED_MIME_SET.has('text/html')).toBe(false)
    for (const e of ['svg', 'html', 'htm', 'js', 'exe', 'bat']) expect(ALLOWED_EXTENSIONS.has(e), e).toBe(false)
  })
  it('the set and the list agree, and the usual office, picture, video and audio types are in', () => {
    expect(ALLOWED_MIME_SET.size).toBe(ALLOWED_MIME_TYPES.length)
    for (const t of ['image/png', 'application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'video/webm', 'audio/mpeg', 'text/csv']) expect(ALLOWED_MIME_SET.has(t), t).toBe(true)
    for (const e of ['png', 'pdf', 'docx', 'pptx', 'webm', 'mp3', 'wav', 'csv']) expect(ALLOWED_EXTENSIONS.has(e), e).toBe(true)
    expect(MAX_FILE_SIZE_BYTES).toBe(25 * 1024 * 1024)
  })
  it('the content check knows PNG, PDF, ZIP-based office files and MP4, and lets types without a signature through', () => {
    expect(contentMatchesDeclaredType(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0), 'image/png')).toBe(true)
    expect(contentMatchesDeclaredType(bytes(0x3c, 0x68, 0x74, 0x6d, 0x6c), 'image/png')).toBe(false)           // "<html"
    expect(contentMatchesDeclaredType(bytes(0x25, 0x50, 0x44, 0x46), 'application/pdf')).toBe(true)
    expect(contentMatchesDeclaredType(bytes(0x50, 0x4b, 0x03, 0x04), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true)
    expect(contentMatchesDeclaredType(bytes(0x1, 0x2, 0x3, 0x4), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(false)
    // a real MP4 header: 4-byte box size, then "ftyp", then the brand ("isom")
    expect(contentMatchesDeclaredType(bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d), 'video/mp4')).toBe(true)
    expect(contentMatchesDeclaredType(bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70), 'video/mp4')).toBe(true)
    expect(contentMatchesDeclaredType(bytes(0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0), 'video/mp4')).toBe(false)       // an .exe renamed to .mp4
    expect(contentMatchesDeclaredType(bytes(0x66, 0x74, 0x79, 0x70, 0, 0, 0, 0), 'video/mp4')).toBe(false)              // "ftyp" at byte 0 is not an MP4
    expect(contentMatchesDeclaredType(bytes(1, 2, 3), 'text/plain')).toBe(true)
  })
  it('validateAttachment still refuses a disguised file, a wrong type and an oversize file', async () => {
    expect((await validateAttachment(file('a.png', 'image/png', [0x89, 0x50, 0x4e, 0x47, 1, 2]))).valid).toBe(true)
    expect(await validateAttachment(file('evil.png', 'image/png', [0x3c, 0x68, 0x74, 0x6d, 0x6c]))).toMatchObject({ valid: false, code: 'content_mismatch' })
    expect(await validateAttachment(file('x.svg', 'image/svg+xml', [0x3c, 0x73]))).toMatchObject({ valid: false, code: 'invalid_type' })
    const big = { size: MAX_FILE_SIZE_BYTES + 1, type: 'image/png', slice: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }) } as unknown as File
    expect(await validateAttachment(big)).toMatchObject({ valid: false, code: 'too_large' })
  })
})
