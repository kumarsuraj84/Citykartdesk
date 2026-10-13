// How an attachment is handed back to the browser. Audit findings D-053 / D-054 / SEC-D-12.
//   - The content type comes from the file's own extension through a fixed table, never from the stored `mime_type` column: that column is
//     writable by the uploader, and an attachment turned into text/html would run script in the viewer's session.
//   - Only images, PDF and plain text open in the browser; everything else downloads.
//   - The file name is sent in the standard encoded form so non-ASCII names survive.

const TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
  zip: 'application/zip', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav',
}
const OPEN_IN_BROWSER = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain; charset=utf-8'])

export function contentTypeForFileName(fileName: string): string {
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : ''
  return TYPE_BY_EXT[ext] ?? 'application/octet-stream'
}

export function contentDisposition(fileName: string, contentType: string): string {
  const kind = OPEN_IN_BROWSER.has(contentType) ? 'inline' : 'attachment'
  const safe = (fileName || 'file').replace(/[\r\n]/g, ' ')
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/** A request attachment's file must live in that request's own folder (the app always stores it as <request id>/...). */
export function pathBelongsToRequest(storagePath: string, requestId: string): boolean {
  return typeof storagePath === 'string' && storagePath.startsWith(`${requestId}/`) && !storagePath.split('/').some((p) => p === '..' || p === '.' || p === '')
}
