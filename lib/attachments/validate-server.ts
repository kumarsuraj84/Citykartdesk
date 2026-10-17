// The check every SERVER-side upload path runs before it stores anything: the shared type / size / signature check (also used in the browser for a quick
// answer), then the content inspection - macros and, when one is configured, the malware scanner (VAPT-065). Kept apart from validate.ts because that file is
// also bundled into browser components and the scanner needs Node.
import { validateAttachment, type ValidationResult } from '@/lib/attachments/validate'
import { inspectUpload } from '@/lib/attachments/scan'

export async function validateAttachmentServer(file: File): Promise<ValidationResult> {
  const basic = await validateAttachment(file)
  if (!basic.valid) return basic
  const inspected = await inspectUpload(file)
  if (!inspected.ok) return { valid: false, error: inspected.error, code: inspected.code }
  return { valid: true }
}
