'use client'

import { useState, useTransition, useRef, useCallback } from 'react'
import { Loader2, Send, ChevronDown, Paperclip, X, FileIcon, AlertCircle } from 'lucide-react'
import { addComment, deleteEmptyComment } from '@/lib/actions/requests'
import { uploadAttachment } from '@/lib/actions/attachments'
import { validateAttachment } from '@/lib/attachments/validate'
import { CANNED_RESPONSES, CANNED_CATEGORIES } from '@/lib/constants/canned-responses'

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
  const [error, setError]                    = useState<string | null>(null)
  const [isPending, startTransition]         = useTransition()
  const [showCanned, setShowCanned]          = useState(false)
  const [cannedSearch, setCannedSearch]      = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cannedRef   = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = useCallback(async (incoming: File[]) => {
    setFileError(null)
    for (const file of incoming) {
      const result = await validateAttachment(file)
      if (!result.valid) {
        setFileError(`"${file.name}": ${result.error ?? 'Invalid file.'}`)
        return
      }
    }
    setFiles((cur) => [...cur, ...incoming])
  }, [])

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    if (picked.length) addFiles(picked)
    e.target.value = ''
  }

  function removeFileAt(index: number) {
    setFiles((cur) => cur.filter((_, i) => i !== index))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const pendingBody = body.trim()
    if (!pendingBody && files.length === 0) return
    setError(null)
    const pendingFiles = files
    startTransition(async () => {
      const result = await addComment(requestId, body, isInternal, pendingFiles.length > 0)
      if (result.error || !result.commentId) {
        setError(result.error ?? 'Failed to post comment.')
        return
      }

      let uploadFailures = 0
      for (const file of pendingFiles) {
        const fd = new FormData()
        fd.append('file', file)
        const uploadResult = await uploadAttachment(requestId, fd, result.commentId)
        if (uploadResult.error) uploadFailures++
      }

      // Nothing but attachments were posted and every one failed — the comment
      // is now an empty bubble with nothing to show, so remove it instead of
      // leaving it behind.
      if (!pendingBody && uploadFailures === pendingFiles.length && pendingFiles.length > 0) {
        await deleteEmptyComment(result.commentId)
        setError('Attachment(s) failed to upload. Nothing was posted.')
        setFiles([])
        textareaRef.current?.focus()
        return
      }

      setBody('')
      setIsInternal(false)
      setFiles([])
      if (uploadFailures > 0) {
        setError(
          uploadFailures === pendingFiles.length
            ? 'Comment posted, but the attachment(s) failed to upload.'
            : `Comment posted, but ${uploadFailures} of ${pendingFiles.length} attachment(s) failed to upload.`
        )
      }
      textareaRef.current?.focus()
    })
  }

  function insertCanned(text: string) {
    setBody(text)
    setShowCanned(false)
    setCannedSearch('')
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(text.length, text.length)
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

      {fileError && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{fileError}</span>
          <button type="button" onClick={() => setFileError(null)} className="shrink-0 rounded-sm hover:text-red-900">
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
            title="Attach files"
            className="flex min-h-[36px] cursor-pointer select-none items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            <Paperclip className="h-3.5 w-3.5" />
            Attach
          </button>
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
          {isPending ? 'Posting…' : 'Post'}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
      )}
    </form>
  )
}
