// Buffer-based counterpart to lib/attachments/validate.ts in the main
// Next.js app — that one operates on a browser File object (`.slice()`,
// `.arrayBuffer()`), which doesn't exist for this worker's mail-parsed
// Buffer attachments, and this project has no import path into the app's
// lib/ tree (separate package.json/tsconfig, no @/ alias). Kept in sync by
// hand: same allowlist, same magic-byte signatures.
//
// Without this, an inbound email's attachment MIME type (fully
// attacker-controlled) was trusted as-is and stored/served verbatim — an
// attachment declaring image/svg+xml or text/html with embedded <script>
// would execute when a reviewer opened the signed URL Supabase Storage
// hands back. This closes that gap the same way user-uploaded attachments
// are already gated.

const ALLOWED_MIME_TYPES = new Set<string>([
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
])

const MAGIC_BYTES: Map<string, number[][]> = new Map([
  ['image/jpeg', [[0xff, 0xd8, 0xff]]],
  ['image/png', [[0x89, 0x50, 0x4e, 0x47]]],
  ['image/gif', [[0x47, 0x49, 0x46, 0x38]]],
  ['image/webp', [[0x52, 0x49, 0x46, 0x46]]],
  ['application/pdf', [[0x25, 0x50, 0x44, 0x46]]],
  ['application/zip', [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]]],
  ['application/x-zip-compressed', [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06]]],
  ['video/mp4', [[0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]]],
])

const ZIP_BASED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

const ZIP_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
]

function signaturesMatch(bytes: Buffer, signatures: number[][], offset = 0): boolean {
  return signatures.some((sig) => sig.every((byte, i) => bytes[offset + i] === byte))
}

export function validateInboundAttachment(content: Buffer, declaredType: string | undefined): { valid: boolean; reason?: string } {
  const type = (declaredType ?? '').split(';')[0].trim().toLowerCase()

  if (!ALLOWED_MIME_TYPES.has(type)) {
    return { valid: false, reason: `disallowed content type "${type || '(none)'}"` }
  }

  if (ZIP_BASED_MIME_TYPES.has(type)) {
    if (!signaturesMatch(content, ZIP_SIGNATURES)) return { valid: false, reason: 'content does not match declared type' }
  } else if (type === 'video/mp4') {
    if (!signaturesMatch(content, MAGIC_BYTES.get('video/mp4')!, 4)) return { valid: false, reason: 'content does not match declared type' }
  } else if (MAGIC_BYTES.has(type)) {
    if (!signaturesMatch(content, MAGIC_BYTES.get(type)!)) return { valid: false, reason: 'content does not match declared type' }
  }

  return { valid: true }
}
