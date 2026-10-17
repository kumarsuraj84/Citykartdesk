// image/svg+xml is deliberately excluded — see the matching comment in
// lib/actions/attachments.ts (SVG opened via a direct link can execute its
// embedded script, unlike an SVG loaded through an <img> tag).
export const ALLOWED_MIME_TYPES: string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
]

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB

// File signatures (magic bytes) keyed by MIME type.
// Each entry is a list of possible byte sequences — any one match is sufficient.
const MAGIC_BYTES: Map<string, number[][]> = new Map([
  ['image/jpeg', [[0xff, 0xd8, 0xff]]],
  ['image/png', [[0x89, 0x50, 0x4e, 0x47]]],
  ['image/gif', [[0x47, 0x49, 0x46, 0x38]]],
  ['image/webp', [[0x52, 0x49, 0x46, 0x46]]], // RIFF header
  ['application/pdf', [[0x25, 0x50, 0x44, 0x46]]], // %PDF
  [
    'application/zip',
    [
      [0x50, 0x4b, 0x03, 0x04],
      [0x50, 0x4b, 0x05, 0x06],
    ],
  ],
  [
    'application/x-zip-compressed',
    [
      [0x50, 0x4b, 0x03, 0x04],
      [0x50, 0x4b, 0x05, 0x06],
    ],
  ],
  // an MP4 starts with a 4-byte box size and then the letters "ftyp" (bytes 4-7); checked at offset 4 below. (It used to expect
  // 00 00 00 18 "ftyp" starting AT byte 4, which no real MP4 has, so genuine MP4 files were always refused.)
  ['video/mp4', [[0x66, 0x74, 0x79, 0x70]]],
])

// Office Open XML formats (.docx, .xlsx, .pptx) are ZIP-based; validate as ZIP.
const ZIP_BASED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
]

export const ALLOWED_MIME_SET: ReadonlySet<string> = new Set(ALLOWED_MIME_TYPES)

/** File-name endings that go with the types above. */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'csv', 'zip',
  'mp4', 'webm', 'mp3', 'wav',
])

export interface ValidationResult {
  valid: boolean
  error?: string
  /** Lets a caller react specifically to "too large" (e.g. a dedicated popup
   *  telling the user to reattach within the limit) without string-matching
   *  the error message. */
  code?: 'too_large' | 'invalid_type' | 'content_mismatch' | 'macro' | 'infected' | 'scan_unavailable'
}

function signaturesMatch(bytes: Uint8Array, signatures: number[][], offset = 0): boolean {
  return signatures.some((sig) =>
    sig.every((byte, i) => bytes[offset + i] === byte)
  )
}

/**
 * Do the first bytes of a file look like the type it claims to be? Types without a known signature (plain text, audio...) pass: for those
 * the allow-list is the only gate. Shared by every upload path (web, tasks, WhatsApp) so they cannot drift apart again (D-055).
 */
export function contentMatchesDeclaredType(bytes: Uint8Array, mimeType: string): boolean {
  if (ZIP_BASED_MIME_TYPES.has(mimeType)) return signaturesMatch(bytes, ZIP_SIGNATURES)
  if (mimeType === 'video/mp4') return signaturesMatch(bytes, MAGIC_BYTES.get('video/mp4')!, 4)
  if (MAGIC_BYTES.has(mimeType)) return signaturesMatch(bytes, MAGIC_BYTES.get(mimeType)!)
  return true
}

export async function validateAttachment(file: File): Promise<ValidationResult> {
  // 1. Size check
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: 'File exceeds 25MB limit.', code: 'too_large' }
  }

  // 2. MIME type allowlist check
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { valid: false, error: 'File type not allowed.', code: 'invalid_type' }
  }

  // 3. Read first 16 bytes for magic byte inspection
  const buf = await file.slice(0, 16).arrayBuffer()
  const bytes = new Uint8Array(buf)

  // 4. Magic byte check: the bytes must look like the type the file claims to be
  if (!contentMatchesDeclaredType(bytes, file.type)) {
    return { valid: false, error: 'File content does not match declared type.', code: 'content_mismatch' }
  }

  return { valid: true }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
