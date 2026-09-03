'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { Loader2, Paperclip, Send, X, FileText, Image, Search } from 'lucide-react'
import { addTaskComment } from '@/lib/actions/tasks'
import { uploadTaskAttachment } from '@/lib/actions/task-attachments'
import { formatRelativeTime } from '@/lib/utils'
import type { TaskCommentWithAuthor, TaskActivityWithActor } from '@/types'
import type { TaskAttachment } from '@/lib/queries/tasks'
import type { Enums } from '@/types/database'

type TaskActivityAction = Enums<'task_activity_action'>
type FeedTab = 'all' | 'comments' | 'activity' | 'files'

const ACTIVITY_LABELS: Record<TaskActivityAction, string> = {
  created:        'created this task',
  assigned:       'assigned this task',
  unassigned:     'unassigned this task',
  status_changed: 'updated the status',
  comment_added:  'added a comment',
  completed:      'marked as done',
  reopened:       'reopened this task',
  cancelled:      'cancelled this task',
}

type FeedItem =
  | { kind: 'comment'; data: TaskCommentWithAuthor }
  | { kind: 'activity'; data: TaskActivityWithActor }

function AvatarInitial({ name }: { name: string }) {
  const initials = name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  const colors = ['bg-violet-100 text-violet-700','bg-blue-100 text-blue-700','bg-emerald-100 text-emerald-700','bg-amber-100 text-amber-700','bg-rose-100 text-rose-700']
  const color = colors[name.charCodeAt(0) % colors.length]
  return (
    <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${color}`}>
      {initials}
    </span>
  )
}

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return Image
  return FileText
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

interface TaskActivityFeedProps {
  taskId: string
  comments: TaskCommentWithAuthor[]
  activity: TaskActivityWithActor[]
  attachments?: TaskAttachment[]
  currentUserId: string
  currentUserName: string
  onCommentPosted: () => void
}

const TABS: { key: FeedTab; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'comments', label: 'Comments' },
  { key: 'activity', label: 'Activity' },
  { key: 'files',    label: 'Files' },
]

export function TaskActivityFeed({
  taskId,
  comments,
  activity,
  attachments = [],
  currentUserId,
  currentUserName,
  onCommentPosted,
}: TaskActivityFeedProps) {
  const [localComments, setLocalComments] = useState<TaskCommentWithAuthor[]>(comments)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [attachFile, setAttachFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [tab, setTab] = useState<FeedTab>('all')
  const [search, setSearch] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const feedBottomRef = useRef<HTMLDivElement>(null)

  // Sync if server sends new comments (after panel re-fetch). Adjusting state during
  // render (React's documented pattern) instead of an effect, since this mirrors a prop.
  const [prevComments, setPrevComments] = useState(comments)
  if (prevComments !== comments) {
    setPrevComments(comments)
    setLocalComments(comments)
  }

  // Scroll to bottom when comments change
  useEffect(() => {
    feedBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [localComments.length])

  const q = search.trim().toLowerCase()
  const feed: FeedItem[] = []
  if (tab === 'all' || tab === 'activity') {
    for (const a of activity) {
      if (a.action !== 'comment_added') feed.push({ kind: 'activity', data: a })
    }
  }
  if (tab === 'all' || tab === 'comments') {
    for (const c of localComments) feed.push({ kind: 'comment', data: c })
  }
  feed.sort((a, b) =>
    new Date(a.data.created_at).getTime() - new Date(b.data.created_at).getTime()
  )
  const visibleFeed = q
    ? feed.filter((item) => {
        if (item.kind === 'comment') return item.data.body.toLowerCase().includes(q)
        const actor = item.data.actor?.full_name?.toLowerCase() ?? ''
        return actor.includes(q) || String(item.data.action).includes(q)
      })
    : feed
  const visibleFiles = q ? attachments.filter(f => f.file_name.toLowerCase().includes(q)) : attachments

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) setAttachFile(file)
    e.target.value = ''
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() && !attachFile) return
    setError(null)

    // Optimistic comment — show immediately
    const optimisticId = `opt-${Date.now()}`
    const optimisticComment: TaskCommentWithAuthor = {
      id: optimisticId,
      task_id: taskId,
      author_id: currentUserId,
      body: body.trim(),
      is_internal: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      author: { id: currentUserId, full_name: currentUserName },
    }
    if (body.trim()) {
      setLocalComments(prev => [...prev, optimisticComment])
    }
    const submittedBody = body.trim()
    const submittedFile = attachFile
    setBody('')
    setAttachFile(null)

    startTransition(async () => {
      try {
        // Upload attachment first if present
        if (submittedFile) {
          setUploading(true)
          const fd = new FormData()
          fd.append('file', submittedFile)
          const uploadResult = await uploadTaskAttachment(taskId, fd)
          setUploading(false)
          if (uploadResult.error) {
            setError(uploadResult.error)
            setLocalComments(prev => prev.filter(c => c.id !== optimisticId))
            return
          }
        }

        // Post comment if there's text
        if (submittedBody) {
          const result = await addTaskComment(taskId, submittedBody)
          if (result.error) {
            setError(result.error)
            setLocalComments(prev => prev.filter(c => c.id !== optimisticId))
            return
          }
        }

        // Re-fetch panel to get real comment + attachment data
        onCommentPosted()
      } catch {
        setError('Something went wrong. Please try again.')
        setLocalComments(prev => prev.filter(c => c.id !== optimisticId))
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Tabs + search */}
      <div className="space-y-2">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              {t.key === 'files' && attachments.length > 0 && <span className="ml-1 text-muted-foreground">{attachments.length}</span>}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search activity…"
            className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* Files tab */}
      {tab === 'files' && (
        visibleFiles.length > 0 ? (
          <div className="space-y-2">
            {visibleFiles.map((f) => {
              const Icon = fileIcon(f.file_name)
              return (
                <div key={f.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/20 px-3 py-2">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">{f.file_name}</p>
                    <p className="text-[10px] text-muted-foreground" suppressHydrationWarning>
                      {formatBytes(f.file_size)}{f.uploader ? ` · ${f.uploader.full_name}` : ''} · {formatRelativeTime(f.created_at)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">No files yet.</p>
        )
      )}

      {/* Feed (all / comments / activity) */}
      {tab !== 'files' && (
        visibleFeed.length > 0 ? (
        <div className="space-y-3">
          {visibleFeed.map((item) => {
            if (item.kind === 'comment') {
              const c = item.data
              const isOptimistic = c.id.startsWith('opt-')
              return (
                <div key={c.id} className={`flex gap-2.5 ${isOptimistic ? 'opacity-60' : ''}`}>
                  <AvatarInitial name={c.author.full_name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-xs font-semibold text-foreground">{c.author.full_name}</span>
                      <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                        {isOptimistic ? 'just now' : formatRelativeTime(c.created_at)}
                      </span>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
                      <p className="text-sm text-foreground whitespace-pre-wrap">{c.body}</p>
                    </div>
                  </div>
                </div>
              )
            }

            const a = item.data
            const meta = a.metadata as Record<string, unknown>
            const actorName = a.actor?.full_name ?? 'System'
            const label = ACTIVITY_LABELS[a.action as TaskActivityAction] ?? a.action
            let detail: string | null = null
            if (a.action === 'status_changed' && meta.from && meta.to) {
              detail = `${meta.from} → ${meta.to}`
            }

            return (
              <div key={a.id} className="flex items-start gap-2.5 text-xs text-muted-foreground">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                <p className="leading-relaxed">
                  <span className="font-medium text-foreground">{actorName}</span>
                  {' '}{label}
                  {detail && <span className="ml-1 text-muted-foreground">({detail})</span>}
                  <span className="ml-2" suppressHydrationWarning>{formatRelativeTime(a.created_at)}</span>
                </p>
              </div>
            )
          })}
          <div ref={feedBottomRef} />
        </div>
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {q ? 'No matching activity.' : 'No activity yet.'}
          </p>
        )
      )}

      {/* Comment form */}
      <form onSubmit={handleSubmit} className="space-y-2 pt-2 border-t border-border">
        {/* Attachment preview */}
        {attachFile && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
            {(() => { const Icon = fileIcon(attachFile.name); return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" /> })()}
            <span className="flex-1 truncate text-xs text-foreground">{attachFile.name}</span>
            <span className="text-[11px] text-muted-foreground">{formatBytes(attachFile.size)}</span>
            <button type="button" onClick={() => setAttachFile(null)} className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { handleSubmit(e) } }}
          placeholder="Add a comment… (⌘↵ to send)"
          rows={3}
          className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex items-center justify-between">
          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Attach file"
          >
            <Paperclip className="h-3.5 w-3.5" />
            Attach
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip,.mp4"
          />

          <button
            type="submit"
            disabled={isPending || uploading || (!body.trim() && !attachFile)}
            className="btn-gradient disabled:opacity-40 flex items-center gap-1.5"
          >
            {(isPending || uploading) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {uploading ? 'Uploading…' : isPending ? 'Posting…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  )
}
