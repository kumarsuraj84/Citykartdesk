// Where an inbound e-mail attachment is stored. Audit finding D-052: the object key used the SENDER's file name, taken from the e-mail's MIME
// headers (controlled by anyone who can e-mail the intake address), with "overwrite if it exists" turned on. A name containing "/" or ".."
// could place the object outside the message's folder, and two attachments with the same name in one e-mail overwrote each other.
//
// The key is now made only of generated values; the original file name is kept in the database column `file_name`, never in the key.
import { randomUUID } from 'node:crypto'

/** `<org>/<message>/<random uuid>[.ext]`, where ext is a short, lower-case alphanumeric extension taken from the sender's file name. */
export function attachmentStorageKey(orgId: string, messageId: string, fileName: string): string {
  const raw = fileName.includes('.') ? fileName.split('.').pop()! : ''
  const ext = /^[a-z0-9]{1,8}$/i.test(raw) ? `.${raw.toLowerCase()}` : ''
  return `${orgId}/${messageId}/${randomUUID()}${ext}`
}
