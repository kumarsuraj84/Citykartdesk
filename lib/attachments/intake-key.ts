// Intake attachments are stored as <org id>/<message id>/<file> (api/src/intake/storage-key.ts; older objects kept the sender's file name as
// the last part). The download route reads whatever path the database row holds with the server's elevated storage client, so it only
// follows paths of exactly that three-part shape (audit D-052).

export function isSafeIntakeStoragePath(path: unknown): boolean {
  if (typeof path !== 'string') return false
  const parts = path.split('/')
  if (parts.length !== 3) return false
  // eslint-disable-next-line no-control-regex
  return parts.every((p) => p !== '' && p !== '.' && p !== '..' && !/[\\%?#\u0000-\u001f]/.test(p))
}
