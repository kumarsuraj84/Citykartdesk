// Sends the "you were copied on this ticket" e-mails: one message per person, each with the ticket details, the complete public
// conversation (the new comment marked) and, when asked, the ticket PDF. Not a server action: the screen's action checks who may
// copy whom first (lib/actions/ticketCopy.ts) and then calls this.

import { sendEmail } from '@/lib/email/send'
import { absoluteAppUrl } from '@/lib/email/notify-email'
import { ticketCopyEmail } from '@/lib/email/ticket-copy-template'
import { renderTicketPdf } from '@/lib/pdf/ticket-pdf'
import { ticketPdfFileName, type TicketPdfModel } from '@/lib/requests/ticket-pdf-model'
import { logActivity } from '@/lib/activity'
import type { CcContact } from '@/lib/requests/cc-recipients'

export interface CopyResult { email: string; name: string; ok: boolean; error?: string }

export async function deliverTicketCopies(p: {
  requestId: string
  model: TicketPdfModel
  newCommentId: string
  recipients: CcContact[]
  attachPdf: boolean
  copiedBy: string
  actorId: string
}): Promise<{ results: CopyResult[]; pdfAttached: boolean }> {
  // one PDF for everyone: it is built from the requester's view, so it holds no internal notes or technician-only fields
  let attachments: { filename: string; content: string }[] | undefined
  if (p.attachPdf) {
    try {
      attachments = [{ filename: ticketPdfFileName(p.model.requestNo), content: (await renderTicketPdf(p.model)).toString('base64') }]
    } catch (e) {
      console.error('[ticket-copy] PDF could not be built; sending without it', e)
    }
  }

  const requestUrl = absoluteAppUrl(`/requests/${p.requestId}`)
  const results = await Promise.all(p.recipients.map(async (r): Promise<CopyResult> => {
    try {
      const mail = ticketCopyEmail({
        recipientName: r.name.split(' ')[0] || 'there',
        copiedBy: p.copiedBy, model: p.model, newCommentId: p.newCommentId, requestUrl, pdfAttached: !!attachments,
      })
      const res = await sendEmail({ to: r.email, subject: mail.subject, html: mail.html, text: mail.text, attachments, threadRequestNo: p.model.requestNo })
      return res.error ? { email: r.email, name: r.name, ok: false, error: res.error } : { email: r.email, name: r.name, ok: true }
    } catch (e) {
      return { email: r.email, name: r.name, ok: false, error: e instanceof Error ? e.message : 'Could not send.' }
    }
  }))

  const sent = results.filter((r) => r.ok)
  if (sent.length > 0) {
    // shown in the ticket's History tab ("copied a comment by e-mail ... Sent to ...")
    await logActivity({ requestId: p.requestId, actorId: p.actorId, action: 'comment_added', metadata: { cc: sent.map((r) => ({ email: r.email, name: r.name })), comment_id: p.newCommentId } })
  }
  return { results, pdfAttached: !!attachments }
}
