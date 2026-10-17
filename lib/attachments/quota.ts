// How much one person may upload (VAPT-065 / VA-INT-10 rest): a burst limit and a daily limit, counted in the database so they hold across restarts and
// across application processes. A real person attaching files to tickets stays far below both; a script filling the file store does not.
import { sharedRateLimited } from '@/lib/security/shared-limits'

export const UPLOADS_PER_10_MIN = 60
export const UPLOADS_PER_DAY = 400
export const UPLOAD_LIMIT_MESSAGE = 'You have uploaded a lot of files recently. Please wait a while and try again.'

export async function uploadAllowed(userId: string): Promise<boolean> {
  if (await sharedRateLimited(`upload:${userId}`, UPLOADS_PER_10_MIN, 600)) return false
  if (await sharedRateLimited(`upload-day:${userId}`, UPLOADS_PER_DAY, 86_400)) return false
  return true
}
