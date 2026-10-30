'use client'

import { useState, useTransition, useRef, useCallback } from 'react'
import { Loader2, Send, ChevronDown, Paperclip, X, FileIcon, AlertCircle, AtSign } from 'lucide-react'
import { addComment, deleteEmptyComment } from '@/lib/actions/requests'
import { uploadAttachment } from '@/lib/actions/attachments'
import { copyCommentByEmail } from '@/lib/actions/ticketCopy'
import { CcField, type CcChip } from './CcField'
import { validateAttachment } from '@/lib/attachments/validate'
import { CANNED_RESPONSES, CANNED_CATEGORIES } from '@/lib/constants/canned-responses'
import { AlertModal } from '@/components/ui/AlertModal'

interface CommentFormProps {
  requestId: string
  canPostInternal: boolean
}

const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.mp4,.webm,.mp3,.wav'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function CommentForm({ requestId, canPostInternal }: CommentFormProps) {
  const [body, setBody]                      = useState('')
  const [isInternal, setIsInternal]          = useState(false)
  const [files, setFiles]                    = useState<File[]>([])
  const [fileError, setFileError]            = useState<string | null>(null)
  const [tooLargeFileName, setTooLargeFileName] = useState<string | null>(null)
  const [error, setError]                    = useState<string | null>(null)
  const [isPending, startTransition]         = useTransition()
  const [ccOpen, setCcOpen]                  = useState(false)
  const [cc, setCc]                          = useState<CcChip[]>([])
  const [attachPdf, setAttachPdf]            = useState(true)
  const [ccNotice, setCcNotice]              = useState<{ ok: boolean; text: string } | null>(null)
  // Set when the comment itself was posted but some of its files did not go up: the failed files stay in the list and "Retry upload" sends them to this comment.
  const [retryCommentId, setRetryCommentId]  = useState<string | null>(null)
  const [showCanned, setShowCanned]          = useState(false)
  const [cannedSearch, setCannedSearch]      = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cannedRef   = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback(async (incoming: File[]) => {
    setFileError(null)
    // One bad file in a multi-select must not throw away the good ones: keep the valid files, report the others.
    const valid: File[] = []
    const tooLarge: string[] = []
    const problems: string[] = []
    for (const file of incoming) {
      const result = await validateAttachment(file)
      if (result.valid) valid.push(file)
      else if (result.code === 'too_large') tooLarge.push(file.name)
      else problems.push(`"${file.name}": ${result.error ?? 'Invalid file.'}`)
    }
    // Too-large files are never added to `files` — this popup is the "reattach within the limit" prompt, not a removal step.
    if (tooLarge.length > 0) setTooLargeFileName(tooLarge.join('", "'))
    if (problems.length > 0) setFileError(problems.join(' · '))
    if (valid.length > 0) setFiles((cur) => [...cur, ...valid])
  }, [])

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length) addFiles(picked)
    e.target.value = ''
  }

  function removeFileAt(index: number) {
    const next = files.filter((_, i) => i !== index)
    setFiles(next)
    if (next.length === 0) setRetryCommentId(null)
  }

  // Sends the files one after the other and returns the ones that did not go up. A thrown error (network drop, server restarted)
  // counts as a failed file; it never escapes.
  async function uploadAll(commentId: string, list: File[]): Promise<File[]> {
    const failed: File[] = []
    for (const file of list) {
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await uploadAttachment(requestId, fd, commentId)
        if (res.error) failed.push(file)
      } catch {
        failed.push(file)
      }
    }
    return failed
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const pendingBody = body.trim()
    if (!pendingBody && files.length === 0) return
    setError(null)
    setCcNotice(null)
    // an address that is not a CK Desk address must be removed first; nothing is posted until then
    if (!isInternal && cc.some((c) => c.status === 'bad')) {
      setError('Remove the CC addresses marked in red (they are not CK Desk addresses) before posting.')
      return
    }
    const pendingFiles = files
    startTransition(async () => {
     try {
      // The comment is already posted; only its files are sent again (to the same comment).
      if (retryCommentId && !pendingBody && pendingFiles.length > 0) {
        const stillFailed = await uploadAll(retryCommentId, pendingFiles)
        setFiles(stillFailed)
        if (stillFailed.length === 0) { setRetryCommentId(null); setError(null) }
        else setError(`${stillFailed.length} of ${pendingFiles.length} file(s) still could not be uploaded. Press "Retry upload" to try again, or remove them.`)
        return
      }
      setRetryCommentId(null)

      const result = await addComment(requestId, body, isInternal, pendingFiles.length > 0)
      if (result.error || !result.commentId) {
        setError(result.error ?? 'Failed to post comment.')
        return
      }

      const failedFiles = await uploadAll(result.commentId, pendingFiles)
      const uploadFailures = failedFiles.length

      // Nothing but attachments were posted and every one failed — the comment
      // is now an empty bubble with nothing to show, so remove it instead of
      // leaving it behind. The files stay in the list so the person can just press Post again.
      if (!pendingBody && uploadFailures === pendingFiles.length && pendingFiles.length > 0) {
        try { await deleteEmptyComment(result.commentId) } catch { /* the empty comment is cleaned up later; nothing to tell the person */ }
        setError('The files could not be uploaded, so nothing was posted. They are still listed below: press Post to try again.')
        textareaRef.current?.focus()
        return
      }

      // copy the posted comment (with the whole conversation) to the CK Desk addresses in CC - after the files are up, so they are listed
      const ccEmails = !isInternal ? cc.filter((c) => c.status === 'ok').map((c) => c.email) : []
      let notice: { ok: boolean; text: string } | null = null
      if (ccEmails.length > 0) {
        try {
          const out = await copyCommentByEmail(requestId, result.commentId, ccEmails, attachPdf)
          const sentNames = out.sent.map((s) => s.name).join(', ')
          if (out.sent.length > 0 && out.failed.length === 0) notice = { ok: true, text: `Copied by e-mail to ${sentNames}${out.pdfAttached ? ' (PDF attached)' : ''}.` }
          else if (out.sent.length > 0) notice = { ok: false, text: `Copied to ${sentNames}, but not to: ${out.failed.map((f) => `${f.email} (${f.reason})`).join('; ')}` }
          else notice = { ok: false, text: `Comment posted, but the copy was not sent: ${out.error ?? out.failed.map((f) => `${f.email} (${f.reason})`).join('; ')}` }
        } catch {
          notice = { ok: false, text: 'Comment posted, but the CC e-mails could not be sent.' }
        }
      }
      setCcNotice(notice)
      setCc([])
      setCcOpen(false)

      setBody('')
      setIsInternal(false)
      // files that did not go up stay in the list, with a retry
      setFiles(failedFiles)
      if (uploadFailures > 0) {
        setRetryCommentId(result.commentId)
        setError(
          uploadFailures === pendingFiles.length
            ? 'Comment posted, but the file(s) could not be uploaded. They are still listed below: press "Retry upload" to try again.'
            : `Comment posted, but ${uploadFailures} of ${pendingFiles.length} file(s) could not be uploaded. They are still listed below: press "Retry upload" to try again.`
        )
      }
      textareaRef.current?.focus()
     } catch {
      // The answer never came back (internet dropped, server restarted). Typed text and files are kept.
      setError('Could not send. Check your internet and try again. If your comment already shows in the conversation, do not send it again.')
     }
    })
  }

  // A template is added after what the person has already typed; it never replaces it.
  function insertCanned(text: string) {
    const next = body.trim() ? `${body.replace(/\s+$/, '')}\n\n${text}` : text
    setBody(next)
    setShowCanned(false)
    setCannedSearch('')
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(next.length, next.length)
      }
    }, 0)
  }

  const filtered = cannedSearch
    ? CANNED_RESPONSES.filter(
        (r) =>
          r.label.toLowerCase().includes(cannedSearch.toLowerCase()) ||
          r.body.toLowerCase().includes(cannedSearch.toLowerCase())
      )
    : CANNED_RESPONSES

  const categories = Object.keys(CANNED_CATEGORIES) as (keyof typeof CANNED_CATEGORIES)[]

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div
        className={`relative rounded-xl border transition-colors ${
          isInternal
            ? 'border-amber-200 bg-amber-50/40'
            : 'border-border bg-background'
        }`}
      >
        <textarea
          ref={textareaRef}
          aria-label={isInternal ? 'Internal note' : 'Public comment'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            isInternal
              ? 'Add an internal note (only visible to agents and managers)…'
              : 'Add a public comment…'
          }
          rows={4}
          className={`w-full resize-none rounded-xl bg-transparent px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 ${
            isInternal ? 'focus-visible:ring-amber-300' : 'focus-visible:ring-ring'
          }`}
        />
      </div>

      {canPostInternal && !isInternal && (ccOpen || cc.length > 0) && (
        <CcField chips={cc} onChange={setCc} attachPdf={attachPdf} onAttachPdf={setAttachPdf} />
      )}

      {fileError && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{fileError}</span>
          <button type="button" onClick={() => setFileError(null)} aria-label="Dismiss this message" className="shrink-0 rounded-sm hover:text-red-900">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${file.lastModified}-${i}`}
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-xs"
            >
              <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-foreground">{file.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => removeFileAt(i)}
                aria-label={`Remove ${file.name}`}
                className="shrink-0 rounded-sm text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={onFileInputChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach files (max 25 MB each)"
            className="flex min-h-[36px] cursor-pointer select-none items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            <Paperclip className="h-3.5 w-3.5" />
            Attach
          </button>
          {canPostInternal && !isInternal && (
            <button
              type="button"
              onClick={() => setCcOpen((v) => !v)}
              aria-pressed={ccOpen || cc.length > 0}
              title="Copy this comment, with the whole ticket and conversation, to CK Desk users or OEM contacts by e-mail"
              className={`flex min-h-[36px] cursor-pointer select-none items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${ccOpen || cc.length > 0 ? 'border-primary/40 bg-primary/5 text-primary' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}
            >
              <AtSign className="h-3.5 w-3.5" />
              CC{cc.length > 0 ? ` (${cc.length})` : ''}
            </button>
          )}
          {canPostInternal && (
            <button
              type="button"
              onClick={() => setIsInternal(!isInternal)}
              aria-pressed={isInternal}
              className={`flex min-h-[36px] cursor-pointer select-none items-center gap-2.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                isInternal
                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted'
              }`}
            >
              <span
                className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                  isInternal ? 'bg-amber-400' : 'bg-muted-foreground/30'
                }`}
              >
                <span
                  className={`absolute h-3 w-3 rounded-full bg-white shadow transition-transform ${
                    isInternal ? 'translate-x-3.5' : 'translate-x-0.5'
                  }`}
                />
              </span>
              <span>Internal note</span>
            </button>
          )}

          {/* Canned responses */}
          <div className="relative" ref={cannedRef}>
            <button
              type="button"
              onClick={() => setShowCanned(!showCanned)}
              className="flex min-h-[36px] cursor-pointer select-none items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Templates
              <ChevronDown className={`h-3 w-3 transition-transform ${showCanned ? 'rotate-180' : ''}`} />
            </button>

            {showCanned && (
              <div className="absolute bottom-full left-0 mb-1 z-50 w-72 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
                <div className="p-2 border-b border-border">
                  <input
                    autoFocus
                    value={cannedSearch}
                    onChange={(e) => setCannedSearch(e.target.value)}
                    placeholder="Search templates…"
                    className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                  />
                </div>
                <div className="max-h-60 overflow-y-auto">
                  {cannedSearch ? (
                    filtered.length === 0 ? (
                      <p className="px-3 py-4 text-center text-xs text-muted-foreground">No templates found</p>
                    ) : (
                      <div className="p-1">
                        {filtered.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => insertCanned(r.body)}
                            className="w-full text-left rounded-lg px-2.5 py-2 text-xs hover:bg-muted transition-colors"
                          >
                            <p className="font-medium text-ink">{r.label}</p>
                            <p className="text-muted-foreground line-clamp-1 mt-0.5">{r.body}</p>
                          </button>
                        ))}
                      </div>
                    )
                  ) : (
                    categories.map((cat) => {
                      const items = CANNED_RESPONSES.filter((r) => r.category === cat)
                      if (!items.length) return null
                      return (
                        <div key={cat}>
                          <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                            {CANNED_CATEGORIES[cat]}
                          </p>
                          <div className="p-1">
                            {items.map((r) => (
                              <button
                                key={r.id}
                                type="button"
                                // insertCanned only reads textareaRef.current inside a setTimeout scheduled
                                // from this click handler, never during render — safe ref access.
                                // eslint-disable-next-line react-hooks/refs
                                onClick={() => insertCanned(r.body)}
                                className="w-full text-left rounded-lg px-2.5 py-2 text-xs hover:bg-muted transition-colors"
                              >
                                <p className="font-medium text-ink">{r.label}</p>
                                <p className="text-muted-foreground line-clamp-1 mt-0.5">{r.body}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={isPending || (!body.trim() && files.length === 0)}
          className="btn-gradient disabled:opacity-40"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          {isPending ? 'Posting…' : retryCommentId && !body.trim() ? 'Retry upload' : 'Post'}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
      {ccNotice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-xs ${ccNotice.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{ccNotice.text}</p>
      )}

      {tooLargeFileName && (
        <AlertModal
          title="Attachment too large"
          message={`"${tooLargeFileName}" is more than 25 MB. Attachments are allowed up to 25 MB — please reattach a smaller file and try again.`}
          onOk={() => setTooLargeFileName(null)}
        />
      )}
    </form>
  )
}
