import { saveTicketFile } from '@/lib/attachments/save'
import { MAX_FILE_SIZE_BYTES } from '@/lib/attachments/validate'
import { linkFilesToComment } from '@/lib/vendor/requests'

// The files that come with an e-mail reply (a vendor's FSR, a quote, photos) are kept on the ticket, under the reply they came with. Each file goes through the same checks as
// any upload (allowed type, 25 MB, the real content of the file, the content scan); a file that fails is not stored and an internal note says which one and why.
// Pure picking first (no database), then the storing. Never throws: a file problem must never stop the reply itself from being posted.

export type MailAttachment = { filename?: string | null; contentType?: string | null; content: Buffer; size?: number; related?: boolean; contentDisposition?: string | null }

export const MAX_REPLY_FILES = 10

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', zip: 'application/zip', mp4: 'video/mp4',
}

const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase()

export type PickedFile = { name: string; type: string; content: Buffer }

/**
 * Which attachments of a mail are kept: not the pictures that are part of the mail's own layout (a logo in the signature), at most MAX_REPLY_FILES, nothing empty or
 * over 25 MB. A file the mail program labelled "application/octet-stream" is typed by its extension. `dropped` are the names that were left out, with the reason.
 */
export function pickReplyAttachments(list: MailAttachment[] | null | undefined): { keep: PickedFile[]; dropped: string[] } {
  const keep: PickedFile[] = []
  const dropped: string[] = []
  let n = 0
  for (const a of list ?? []) {
    n++
    const name = (a.filename ?? '').trim() || `attachment-${n}`
    const isInlineImage = a.related === true || ((a.contentDisposition ?? '').toLowerCase() === 'inline' && (a.contentType ?? '').toLowerCase().startsWith('image/'))
    if (isInlineImage) continue                      // a logo or picture of the mail's own layout, not a file somebody sent
    const size = a.size ?? a.content?.length ?? 0
    if (!a.content || size === 0) { dropped.push(`${name} (empty)`); continue }
    if (size > MAX_FILE_SIZE_BYTES) { dropped.push(`${name} (over 25 MB)`); continue }
    if (keep.length >= MAX_REPLY_FILES) { dropped.push(`${name} (more than ${MAX_REPLY_FILES} files)`); continue }
    let type = (a.contentType ?? '').split(';')[0].trim().toLowerCase()
    if (!type || type === 'application/octet-stream') type = MIME_BY_EXT[extOf(name)] ?? type
    keep.push({ name, type: type || 'application/octet-stream', content: a.content })
  }
  return { keep, dropped }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

/** Stores the picked files on the ticket and ties them to the reply. Returns how many were kept. Never throws. */
export async function addReplyFiles(p: {
  admin: AnyClient
  requestId: string
  commentId: string
  /** a ticket's file needs a Citykart person on record: the sender when he is one, else the ticket's technician, else its requester */
  uploadedBy: string
  fromAddress: string
  files: PickedFile[]
  dropped?: string[]
}): Promise<{ added: number; refused: string[] }> {
  const ids: string[] = []
  const refused: string[] = [...(p.dropped ?? [])]
  for (const f of p.files) {
    try {
      const file = new File([new Uint8Array(f.content)], f.name, { type: f.type })
      const saved = await saveTicketFile({ requestId: p.requestId, file, uploadedBy: p.uploadedBy })
      if (saved.attachmentId) ids.push(saved.attachmentId)
      else refused.push(`${f.name} (${saved.error ?? 'not accepted'})`)
    } catch (e) {
      console.error('[inbound] could not store a reply file', e)
      refused.push(`${f.name} (could not be stored)`)
    }
  }
  await linkFilesToComment(p.requestId, p.commentId, ids)
  if (refused.length > 0) {
    try {
      await p.admin.from('request_comments').insert({
        request_id: p.requestId, author_id: null, external_name: 'Citykart Desk', external_email: p.fromAddress, is_internal: true,
        body: `The e-mail reply from ${p.fromAddress} came with file(s) that were not added to the conversation: ${refused.join('; ')}. If they are needed, ask the sender to upload them in the portal, or add them by hand.`,
      })
    } catch { /* a note must never break the sync */ }
  }
  return { added: ids.length, refused }
}
