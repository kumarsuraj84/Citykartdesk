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
  // ftyp box at offset 4 (bytes 4-11 = 00 00 00 18 66 74 79 70)
  ['video/mp4', [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]]],
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

export interface ValidationResult {
  valid: boolean
  error?: string
}

function signaturesMatch(bytes: Uint8Array, signatures: number[][], offset = 0): boolean {
  return signatures.some((sig) =>
    sig.every((byte, i) => bytes[offset + i] === byte)
  )
}

export async function validateAttachment(file: File): Promise<ValidationResult> {
  // 1. Size check
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: 'File exceeds 25MB limit.' }
  }

  // 2. MIME type allowlist check
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { valid: false, error: 'File type not allowed.' }
  }

  // 3. Read first 16 bytes for magic byte inspection
  const buf = await file.slice(0, 16).arrayBuffer()
  const bytes = new Uint8Array(buf)

  // 4. Magic byte check — only for types we have signatures for
  if (ZIP_BASED_MIME_TYPES.has(file.type)) {
    // 5. Special case: .docx/.xlsx/.pptx are ZIP-based
    if (!signaturesMatch(bytes, ZIP_SIGNATURES)) {
      return { valid: false, error: 'File content does not match declared type.' }
    }
  } else if (file.type === 'video/mp4') {
    // ftyp box starts at byte offset 4
    if (!signaturesMatch(bytes, MAGIC_BYTES.get('video/mp4')!, 4)) {
      return { valid: false, error: 'File content does not match declared type.' }
    }
  } else if (MAGIC_BYTES.has(file.type)) {
    if (!signaturesMatch(bytes, MAGIC_BYTES.get(file.type)!)) {
      return { valid: false, error: 'File content does not match declared type.' }
    }
  }

  return { valid: true }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
