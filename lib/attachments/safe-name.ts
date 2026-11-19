/**
 * A file name that is safe to put in a storage path.
 *
 * Unsafe characters become "_", runs of "_" are collapsed, and a run of dots becomes ONE dot. The last rule matters: the database refuses a stored path that
 * contains ".." (it guards against walking out of the ticket's folder), so a perfectly normal file called "photo..jpg" or "scan ..pdf" used to fail with
 * "an attachment must be stored in its own request folder" and the person lost the file. The name SHOWN to people is never changed, only the name in the path.
 */
export function safeStorageName(name: string, maxLength = 200): string {
  const cleaned = String(name ?? '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')          // no hidden-file style leading dot
  const cut = cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned
  return cut || 'file'
}
