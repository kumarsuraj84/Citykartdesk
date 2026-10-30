// How much one person may upload (VAPT-065 / VA-INT-10 rest): a burst limit and a daily limit, counted in the database so they hold across restarts and
// across application processes. A real person attaching files to tickets stays far below both; a script filling the file store does not.
//
// The first two limits count FILES. A few 25 MB files per minute stay far below them yet fill the NAS in a day, so the size is limited too (audit A-07):
//  - a daily byte budget per person (UPLOAD_BYTES_PER_DAY), counted in the database like the file counts;
//  - a total per ticket (TICKET_BYTES_MAX), read from the attachments already on the ticket.
// uploadAllowed() is the old count check, unchanged. uploadBytesAllowed() and ticketBytesAllowed() are called by the upload actions once the size of the file is
// known (lib/actions/attachments.ts, lib/actions/task-attachments.ts): they need the file in hand, the count check runs before it is read.
import { sharedRateLimited, sharedQuotaExceeded } from '@/lib/security/shared-limits'

export const UPLOADS_PER_10_MIN = 60
export const UPLOADS_PER_DAY = 400
export const UPLOAD_LIMIT_MESSAGE = 'You have uploaded a lot of files recently. Please wait a while and try again.'

export const UPLOAD_BYTES_PER_DAY = 500 * 1024 * 1024
export const TICKET_BYTES_MAX = 200 * 1024 * 1024
export const UPLOAD_BYTES_MESSAGE = 'You have uploaded a lot of data today (the daily limit is 500 MB). Please try again tomorrow, or ask an administrator.'
export const TICKET_BYTES_MESSAGE = 'This ticket already holds the most attachment data it can (200 MB). Remove an old attachment or start a new ticket.'

export async function uploadAllowed(userId: string): Promise<boolean> {
  if (await sharedRateLimited(`upload:${userId}`, UPLOADS_PER_10_MIN, 600)) return false
  if (await sharedRateLimited(`upload-day:${userId}`, UPLOADS_PER_DAY, 86_400)) return false
  return true
}

/** Adds this file's size to the person's daily total; false when that takes it over the daily byte budget. Counted in kilobytes (500 MB = 512,000, fits the counter). */
export async function uploadBytesAllowed(userId: string, bytes: number): Promise<boolean> {
  return !(await sharedQuotaExceeded(`upload-bytes-day:${userId}`, bytes / 1024, UPLOAD_BYTES_PER_DAY / 1024, 86_400))
}

/** True when adding `bytes` to the files already on the ticket stays within the per-ticket total. `admin` is the server's database client. */
export async function ticketBytesAllowed(
  admin: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  requestId: string,
  bytes: number,
): Promise<boolean> {
  try {
    const { data, error } = await admin.from('request_attachments').select('file_size').eq('request_id', requestId).is('deleted_at', null)
    if (error) return true                  // the check must not stop an upload because the lookup failed; the daily budget still applies
    const used = ((data ?? []) as { file_size: number | null }[]).reduce((n, r) => n + (r.file_size ?? 0), 0)
    return used + bytes <= TICKET_BYTES_MAX
  } catch { return true }
}
