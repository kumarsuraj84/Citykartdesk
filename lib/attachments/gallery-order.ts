// Pure helpers for the attachment preview's "every file of this ticket" list. Kept out of the client component file so the
// server pages can call them (a function in a 'use client' file cannot be called from a server component).

/** What the preview needs of one file, nothing about who uploaded it. */
export interface GalleryItem {
  id: string
  file_name: string
  file_size: number
  mime_type: string
  signedUrl: string
}

/** Order a ticket's files the way the page shows them: the files under each message (in message order), then the rest. */
export function orderGalleryItems<T extends GalleryItem & { comment_id?: string | null }>(
  attachments: T[],
  messageIdsInDisplayOrder: string[],
): GalleryItem[] {
  const byMessage = new Map<string, T[]>()
  const loose: T[] = []
  for (const a of attachments) {
    const cid = a.comment_id ?? null
    if (cid) byMessage.set(cid, [...(byMessage.get(cid) ?? []), a])
    else loose.push(a)
  }
  const out: T[] = []
  for (const id of messageIdsInDisplayOrder) out.push(...(byMessage.get(id) ?? []))
  // files that belong to a message not in the list (should not happen), then the original request's own files
  for (const [cid, list] of byMessage) {
    if (!messageIdsInDisplayOrder.includes(cid)) out.push(...list)
  }
  return [...out, ...loose].map((a) => ({ id: a.id, file_name: a.file_name, file_size: a.file_size, mime_type: a.mime_type, signedUrl: a.signedUrl }))
}
