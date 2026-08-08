'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowLeft, Reply, ReplyAll, Forward, Archive, X,
  ClipboardList, CheckCircle2, ShieldCheck, MessageSquare,
  Paperclip, ChevronDown, ExternalLink, Eye, EyeOff,
  Bold, Italic, Underline, List, ListOrdered, Link2, Send,
} from 'lucide-react'
import {
  markMessageRead, archiveMessage, closeWithoutWork,
  addNote, sendFromMessage, type SendAction,
} from '@/lib/actions/intake/communication'
import { convertToWork, type WorkPayload } from '@/lib/actions/intake/work'
import type { InboxMessageDetail } from '@/lib/queries/intake'
import { formatRelativeTime } from '@/lib/utils'
import { EmailBody } from '../../_components/EmailBody'
import { AiBrief } from '@/components/intake/AiBrief'

type ConvertType = 'request' | 'task' | 'approval'

const CONVERT_META: Record<ConvertType, { label: string; icon: React.ReactNode; color: string }> = {
  request:  { label: 'Request',  icon: <ClipboardList className="h-4 w-4" />, color: 'text-blue-600' },
  task:     { label: 'Task',     icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-violet-600' },
  approval: { label: 'Approval', icon: <ShieldCheck className="h-4 w-4" />,  color: 'text-amber-600' },
}

export function WorkspaceClient({
  message, attachments, thread, services, teams,
}: {
  message: InboxMessageDetail
  attachments: { id: string; file_name: string; file_size: number; mime_type: string | null; signedUrl: string | null }[]
  thread: { id: string; subject: string | null; from_address: string | null; received_at: string | null }[]
  services: { id: string; name: string; team_id: string | null }[]
  teams: { id: string; name: string }[]
  profileId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const defaultTeamId = message.channel?.default_team_id ?? teams[0]?.id ?? ''

  // ── Read / archive state ──────────────────────────────────────────────────
  const [isRead, setIsRead]         = useState(message.is_read)
  const [isArchived, setIsArchived] = useState(message.is_archived)

  // ── Compose state ─────────────────────────────────────────────────────────
  const [sendMode, setSendMode]     = useState<SendAction | null>(null)
  const [sendTo, setSendTo]         = useState('')
  const [sendSubject, setSendSubject] = useState('')

  // ── Convert form state ────────────────────────────────────────────────────
  const [convertType, setConvertType] = useState<ConvertType | null>(null)
  const [convertOpen, setConvertOpen] = useState(false)
  const [workTitle, setWorkTitle]     = useState(message.subject ?? '')
  const [workDescription, setWorkDescription] = useState((message.body_text ?? '').slice(0, 600).trim())
  const [workServiceId, setWorkServiceId] = useState(services[0]?.id ?? '')
  const [workTeamId, setWorkTeamId]   = useState(defaultTeamId)

  // ── Note state ────────────────────────────────────────────────────────────
  const [showNote, setShowNote]     = useState(false)
  const [noteBody, setNoteBody]     = useState('')

  // ── Thread toggle ─────────────────────────────────────────────────────────
  const [showThread, setShowThread] = useState(false)

  const review = message.review
  const isConverted = review?.state === 'converted'

  // ── Handlers ──────────────────────────────────────────────────────────────

  function openSend(action: SendAction) {
    setSendMode(action)
    setSendTo(
      action === 'forward' ? ''
      : action === 'reply_all'
        ? [message.from_address, ...(message.to_addresses ?? [])]
            .filter(Boolean).map(a => senderEmail(a as string)).filter(Boolean).join(', ')
        : senderEmail(message.from_address)
    )
    setSendSubject(action === 'forward' ? `Fwd: ${message.subject ?? ''}` : `Re: ${message.subject ?? ''}`)
    setConvertType(null)
    setConvertOpen(false)
  }

  function openConvert(t: ConvertType) {
    setConvertType(t)
    setConvertOpen(false)
    setSendMode(null)
  }

  function handleSend(html: string, text: string) {
    const to = sendTo.split(/[,;]/).map(s => s.trim()).filter(Boolean)
    if (!to.length) { toast.error('Recipient required.'); return }
    if (!text.trim()) { toast.error('Message is empty.'); return }
    startTransition(async () => {
      const res = await sendFromMessage(message.id, {
        action: sendMode!, toAddresses: to, subject: sendSubject, bodyText: text, bodyHtml: html,
      })
      if (!res.ok) { toast.error(res.error ?? 'Send failed.'); return }
      toast.success('Sent.')
      setSendMode(null)
    })
  }

  function handleConvert() {
    if (!convertType) return
    if (!workTitle.trim()) { toast.error('Title is required.'); return }
    if ((convertType === 'request' || convertType === 'approval') && !workServiceId) { toast.error('Select a service.'); return }
    if (!workTeamId) { toast.error('Select a team.'); return }

    const payload: WorkPayload =
      convertType === 'task'
        ? { type: 'task',     title: workTitle, description: workDescription, team_id: workTeamId }
        : { type: convertType, title: workTitle, description: workDescription, service_id: workServiceId, team_id: workTeamId }

    startTransition(async () => {
      const res = await convertToWork(message.id, payload as Exclude<WorkPayload, { type: 'ignore' | 'informational' }>)
      if (!res.ok) { toast.error(res.error); return }
      const label = CONVERT_META[convertType].label
      const no = 'workNo' in res && res.workNo ? ` #${res.workNo}` : ''
      toast.success(`${label}${no} created.`, {
        action: { label: 'Open', onClick: () => router.push((res as { workUrl: string }).workUrl) },
        duration: 6000,
      })
      setConvertType(null)
      router.refresh()
    })
  }

  function handleArchive() {
    const next = !isArchived
    setIsArchived(next)
    startTransition(async () => {
      const r = await archiveMessage(message.id, next)
      if (r.error) { toast.error(r.error); setIsArchived(!next); return }
      toast.success(next ? 'Archived.' : 'Moved to inbox.')
      if (next) router.push('/intake/inbox')
    })
  }

  function handleToggleRead() {
    const next = !isRead
    setIsRead(next)
    startTransition(async () => {
      const r = await markMessageRead(message.id, next)
      if (r.error) { toast.error(r.error); setIsRead(!next) }
    })
  }

  function handleClose() {
    startTransition(async () => {
      const r = await closeWithoutWork(message.id)
      if (r.error) { toast.error(r.error); return }
      toast.success('Marked as done.')
      router.push('/intake/inbox')
    })
  }

  function handleAddNote() {
    if (!noteBody.trim()) return
    startTransition(async () => {
      const r = await addNote(message.id, noteBody)
      if (r.error) { toast.error(r.error); return }
      toast.success('Note added.')
      setNoteBody('')
      setShowNote(false)
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-0">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to inbox
      </button>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* Email header */}
        <div className="border-b border-border px-6 py-4">
          <h1 className={`text-lg font-semibold leading-snug text-foreground ${!isRead ? 'font-bold' : ''}`}>
            {message.subject ?? '(no subject)'}
          </h1>
          <div className="mt-3 flex items-start gap-3">
            {/* Sender avatar */}
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ background: avatarColor(message.from_address ?? '?') }}
            >
              {senderInitial(message.from_address)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold text-foreground">{senderName(message.from_address)}</span>
                <span className="truncate text-xs text-muted-foreground">{senderEmail(message.from_address)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                {message.to_addresses?.length ? <span>to {message.to_addresses.join(', ')}</span> : null}
                <span>·</span>
                <span>{message.received_at ? formatRelativeTime(message.received_at) : '—'}</span>
                {message.channel?.name && <><span>·</span><span>{message.channel.name}</span></>}
              </div>
            </div>
          </div>

          {/* Classification chips */}
          {review && review.state !== 'pending' && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {review.suggested_type && (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 capitalize">
                  {review.suggested_type}
                </span>
              )}
              {review.suggested_department && (
                <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground capitalize">
                  {review.suggested_department}
                </span>
              )}
              {review.suggested_priority && (
                <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground capitalize">
                  {review.suggested_priority}
                </span>
              )}
              {review.suggested_confidence != null && (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  review.suggested_confidence >= 70 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : review.suggested_confidence >= 40 ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-gray-50 text-gray-500 border-gray-200'
                }`}>
                  {review.suggested_confidence}% confident
                </span>
              )}
              {isConverted && (
                <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                  converted
                  {review.created_request_id && (
                    <a href={`/requests/${review.created_request_id}`} className="ml-1 inline-flex items-center gap-0.5 underline">
                      open <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                  {review.created_task_id && (
                    <a href={`/tasks/${review.created_task_id}`} className="ml-1 inline-flex items-center gap-0.5 underline">
                      open <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </span>
              )}
            </div>
          )}
        </div>

        {/* AI brief — Gmail-style summary */}
        <div className="border-b border-border px-6 py-3">
          <AiBrief
            subject={message.subject ?? null}
            bodyText={message.body_text ?? null}
            fromAddress={message.from_address ?? null}
          />
        </div>

        {/* ── Action bar ── */}
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/20 px-4 py-2">
          <ActionBtn icon={<Reply className="h-3.5 w-3.5" />} label="Reply"     onClick={() => openSend('reply')}     active={sendMode === 'reply'} />
          <ActionBtn icon={<ReplyAll className="h-3.5 w-3.5" />} label="Reply All" onClick={() => openSend('reply_all')} active={sendMode === 'reply_all'} />
          <ActionBtn icon={<Forward className="h-3.5 w-3.5" />} label="Forward"  onClick={() => openSend('forward')}  active={sendMode === 'forward'} />

          <div className="mx-1 h-5 w-px bg-border" />

          {/* Convert dropdown */}
          {!isConverted ? (
            <div className="relative">
              <button
                onClick={() => { setConvertOpen(v => !v); setSendMode(null) }}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
              >
                Convert to work <ChevronDown className="h-3 w-3" />
              </button>
              {convertOpen && (
                <div className="absolute left-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-card shadow-md">
                  {(Object.entries(CONVERT_META) as [ConvertType, typeof CONVERT_META[ConvertType]][]).map(([t, m]) => (
                    <button key={t} onClick={() => openConvert(t)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted">
                      <span className={m.color}>{m.icon}</span>
                      <span>{m.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="px-2 text-xs text-muted-foreground">Converted</span>
          )}

          <div className="mx-1 h-5 w-px bg-border" />

          <ActionBtn icon={<MessageSquare className="h-3.5 w-3.5" />} label="Note"    onClick={() => { setShowNote(v => !v); setSendMode(null); setConvertOpen(false) }} active={showNote} />
          <ActionBtn icon={isRead ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} label={isRead ? 'Mark unread' : 'Mark read'} onClick={handleToggleRead} />
          <ActionBtn icon={<Archive className="h-3.5 w-3.5" />} label={isArchived ? 'Unarchive' : 'Archive'} onClick={handleArchive} active={isArchived} />
          <ActionBtn icon={<X className="h-3.5 w-3.5" />} label="Close" onClick={handleClose} disabled={isPending} />
        </div>

        {/* ── Compose panel ── */}
        {sendMode && (
          <div className="border-b border-border bg-muted/10 px-6 py-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground capitalize">
              {sendMode.replace('_', ' ')}
            </p>
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">To</span>
              <input value={sendTo} onChange={e => setSendTo(e.target.value)} placeholder="recipient@example.com" className={iCls} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">Subject</span>
              <input value={sendSubject} onChange={e => setSendSubject(e.target.value)} placeholder="Subject" className={iCls} />
            </div>
            <RichComposer onSend={handleSend} onCancel={() => setSendMode(null)} sending={isPending} />
          </div>
        )}

        {/* ── Convert form ── */}
        {convertType && !isConverted && (
          <div className={`border-b border-border px-6 py-4 space-y-3 ${
            convertType === 'request' ? 'bg-blue-50/30' : convertType === 'task' ? 'bg-violet-50/30' : 'bg-amber-50/30'
          }`}>
            <div className={`flex items-center gap-1.5 text-sm font-semibold ${CONVERT_META[convertType].color}`}>
              {CONVERT_META[convertType].icon}
              Create {CONVERT_META[convertType].label}
            </div>
            <input value={workTitle} onChange={e => setWorkTitle(e.target.value)} placeholder="Title" className={iCls} />
            <textarea value={workDescription} onChange={e => setWorkDescription(e.target.value)} rows={4}
              placeholder="Description (pre-filled from email)" className={`${iCls} resize-none`} />
            {(convertType === 'request' || convertType === 'approval') && (
              <select value={workServiceId} onChange={e => setWorkServiceId(e.target.value)} className={iCls}>
                {services.length === 0
                  ? <option value="">No active services</option>
                  : services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                }
              </select>
            )}
            <select value={workTeamId} onChange={e => setWorkTeamId(e.target.value)} className={iCls}>
              {teams.length === 0
                ? <option value="">No teams</option>
                : teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)
              }
            </select>
            <div className="flex gap-2">
              <button onClick={handleConvert} disabled={isPending}
                className="rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:brightness-110 disabled:opacity-50">
                Create {CONVERT_META[convertType].label}
              </button>
              <button onClick={() => setConvertType(null)} className="rounded-lg border border-border px-4 py-1.5 text-xs text-muted-foreground hover:bg-muted">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Internal note box ── */}
        {showNote && (
          <div className="border-b border-border bg-amber-50/50 px-6 py-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Internal note</p>
            <textarea value={noteBody} onChange={e => setNoteBody(e.target.value)} rows={3}
              placeholder="Visible only to your team…" className={`${iCls} bg-white`} />
            <div className="flex gap-2">
              <button onClick={handleAddNote} disabled={isPending || !noteBody.trim()}
                className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
                Save note
              </button>
              <button onClick={() => setShowNote(false)} className="rounded-lg border border-border px-4 py-1.5 text-xs text-muted-foreground hover:bg-muted">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Email body ── */}
        <div className="px-6 py-5">
          <EmailBody html={message.body_html} text={message.body_text} />
        </div>

        {/* ── Attachments ── */}
        {attachments.length > 0 && (
          <div className="border-t border-border px-6 py-3">
            <div className="flex flex-wrap gap-2">
              {attachments.map(a => (
                <a key={a.id} href={a.signedUrl ?? '#'} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs hover:bg-muted">
                  <Paperclip className="h-3.5 w-3.5" /> {a.file_name}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ── Thread ── */}
        {thread.length > 1 && (
          <div className="border-t border-border px-6 py-3">
            <button
              onClick={() => setShowThread(v => !v)}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showThread ? 'rotate-180' : ''}`} />
              Thread ({thread.length})
            </button>
            {showThread && (
              <div className="mt-2 space-y-1.5">
                {thread.map(t => (
                  <div key={t.id} className="flex items-center justify-between text-xs">
                    <span className={`truncate ${t.id === message.id ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                      {t.subject ?? '(no subject)'} — {t.from_address ?? '—'}
                    </span>
                    <span className="shrink-0 text-muted-foreground">{t.received_at ? formatRelativeTime(t.received_at) : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const iCls = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm'

// Rich reply editor — a contentEditable surface with a formatting toolbar that
// outputs real HTML (and a plain-text fallback), so replies aren't flat text.
function RichComposer({
  onSend, onCancel, sending,
}: { onSend: (html: string, text: string) => void; onCancel: () => void; sending: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); ref.current?.focus() }
  const addLink = () => {
    const url = window.prompt('Link URL')
    if (url) exec('createLink', /^https?:\/\//.test(url) ? url : `https://${url}`)
  }
  const send = () => onSend(ref.current?.innerHTML ?? '', ref.current?.innerText ?? '')

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex items-center gap-0.5 border-b border-border px-2 py-1.5">
        <ToolBtn onClick={() => exec('bold')}><Bold className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn onClick={() => exec('italic')}><Italic className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn onClick={() => exec('underline')}><Underline className="h-3.5 w-3.5" /></ToolBtn>
        <div className="mx-1 h-4 w-px bg-border" />
        <ToolBtn onClick={() => exec('insertUnorderedList')}><List className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn onClick={() => exec('insertOrderedList')}><ListOrdered className="h-3.5 w-3.5" /></ToolBtn>
        <ToolBtn onClick={addLink}><Link2 className="h-3.5 w-3.5" /></ToolBtn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Write your message…"
        className="composer-editor min-h-[140px] px-3 py-2.5 text-sm leading-relaxed text-foreground outline-none [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
      />
      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <button onClick={send} disabled={sending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:brightness-110 disabled:opacity-50">
          <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send'}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-border px-4 py-1.5 text-xs text-muted-foreground hover:bg-muted">
          Cancel
        </button>
      </div>
    </div>
  )
}

function ToolBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      // Prevent the editor losing selection before the command runs.
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  )
}

// ── Sender display helpers ──────────────────────────────────────────────────
// Addresses may be "Name <a@b.com>" or bare "a@b.com".
function parseAddr(addr: string | null): { name: string; email: string } {
  if (!addr) return { name: 'Unknown', email: '' }
  const m = addr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m && m[1].trim()) return { name: m[1].trim(), email: m[2].trim() }
  const email = (m?.[2] ?? addr).trim()
  return { name: email.split('@')[0] || email, email }
}
function senderName(addr: string | null): string { return parseAddr(addr).name }
function senderEmail(addr: string | null): string { return parseAddr(addr).email }
function senderInitial(addr: string | null): string {
  const n = parseAddr(addr).name
  return (n[0] ?? '?').toUpperCase()
}
// Deterministic pleasant colour from the address.
function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return `hsl(${h} 55% 45%)`
}

function ActionBtn({
  icon, label, onClick, active, disabled,
}: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
        active
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
