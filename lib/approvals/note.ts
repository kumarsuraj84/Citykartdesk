/**
 * The technician's optional remarks and files that go with "Send for approval".
 *
 * They are kept as ONE public message in the ticket's conversation (so the approver can read it - an approver cannot read internal notes) whose first line is a
 * fixed marker; the files hang on that message. The approval screen finds the message again by the marker, the sender and the time, and shows it to the approver
 * as "Remarks from the technician" with the files. Pure, so the screen and the server agree on the format.
 */

export const APPROVAL_NOTE_MARKER = '[Sent for approval]'
export const APPROVAL_NOTE_MAX = 2000
/** how close (to the approval's own time) the message must be: it is written in the same step as the approval */
const WINDOW_MS = 5 * 60 * 1000

export function approvalNoteBody(args: { approverNames: string[]; remarks?: string | null; fileCount?: number }): string {
  const names = args.approverNames.map((n) => n.trim()).filter(Boolean).join(', ')
  const remarks = (args.remarks ?? '').trim()
  const lines = [`${APPROVAL_NOTE_MARKER}${names ? ` to ${names}` : ''}`]
  if (remarks) lines.push(remarks)
  else if ((args.fileCount ?? 0) > 0) lines.push(`(${args.fileCount === 1 ? 'a file is' : `${args.fileCount} files are`} attached for you to review)`)
  return lines.join('\n')
}

/** The remarks of such a message (everything after the marker line). */
export function approvalNoteText(body: string): string {
  const i = body.indexOf('\n')
  return i === -1 ? '' : body.slice(i + 1).trim()
}

export const isApprovalNote = (body: string | null | undefined) => String(body ?? '').startsWith(APPROVAL_NOTE_MARKER)

/** The message that goes with this approval: the technician's marker message written when it was sent (the nearest in time). */
export function findApprovalNote<T extends { body: string; created_at: string; author_id?: string | null }>(
  approval: { created_at: string; requested_by?: string | null },
  comments: readonly T[],
): T | null {
  const at = new Date(approval.created_at).getTime()
  let best: T | null = null
  let bestGap = Infinity
  for (const c of comments) {
    if (!isApprovalNote(c.body)) continue
    if (approval.requested_by && c.author_id && c.author_id !== approval.requested_by) continue
    const gap = Math.abs(new Date(c.created_at).getTime() - at)
    if (gap <= WINDOW_MS && gap < bestGap) { best = c; bestGap = gap }
  }
  return best
}

/** The notification text for an approver: the usual line, plus the technician's remarks and how many files came with them. */
export function approvalNotifyBody(title: string, senderName: string, remarks: string | null | undefined, fileCount: number): string {
  const base = `"${title}" has been sent to you for approval.`
  const r = (remarks ?? '').trim()
  const parts = [base]
  if (r) parts.push(`Remarks from ${senderName}: ${r.length > 300 ? r.slice(0, 299) + '…' : r}`)
  if (fileCount > 0) parts.push(`${fileCount === 1 ? '1 file is' : `${fileCount} files are`} attached: open the request to see ${fileCount === 1 ? 'it' : 'them'}.`)
  return parts.join('\n')
}
