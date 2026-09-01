'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Paperclip, X, Sparkles, CheckCircle2, ClipboardList, ShieldCheck, MinusCircle,
  ExternalLink, Reply, ReplyAll, Forward, Archive, MessageSquare, Eye, EyeOff,
  Star, AlertTriangle, Send, Zap, Flame,
} from 'lucide-react'
import { approveAndCreate, reclassifyReview, type WorkPayload } from '@/lib/actions/intake/work'
import { rejectReview } from '@/lib/actions/intake/reviews'
import { markMessageRead, archiveMessage, addNote, sendFromMessage, type SendAction } from '@/lib/actions/intake/communication'
import { starReview, escalateReview } from '@/lib/actions/intake/flags'
import type { IntakeReviewDetail } from '@/lib/queries/intake'
import { EmailBody } from '../../_components/EmailBody'
import { AiBrief } from '@/components/intake/AiBrief'
import { formatRelativeTime } from '@/lib/utils'

type WorkType = 'request' | 'task' | 'approval' | 'informational' | 'ignore'
type Priority = 'low' | 'medium' | 'high' | 'urgent'

const WORK_TYPES: WorkType[] = ['request', 'task', 'approval', 'informational', 'ignore']
const NO_WORK_TYPES: WorkType[] = ['informational', 'ignore']
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent']
const DEPARTMENTS = [
  'hr', 'payroll', 'finance', 'it', 'admin', 'facilities', 'operations',
  'legal', 'procurement', 'support', 'sales', 'marketing', 'security', 'unknown',
]

const WORK_TYPE_META: Record<WorkType, { label: string; icon: React.ReactNode; color: string }> = {
  request:       { label: 'Request',  icon: <ClipboardList className="h-3.5 w-3.5" />, color: 'text-violet-600' },
  task:          { label: 'Task',     icon: <CheckCircle2 className="h-3.5 w-3.5" />,  color: 'text-amber-600' },
  approval:      { label: 'Approval', icon: <ShieldCheck className="h-3.5 w-3.5" />,   color: 'text-emerald-600' },
  informational: { label: 'Informational (FYI)', icon: <MinusCircle className="h-3.5 w-3.5" />, color: 'text-sky-600' },
  ignore:        { label: 'Ignore',   icon: <MinusCircle className="h-3.5 w-3.5" />,   color: 'text-gray-500' },
}

const TYPE_PILL: Record<string, string> = {
  request:       'bg-violet-50 text-violet-700 border-violet-200',
  task:          'bg-amber-50 text-amber-700 border-amber-200',
  approval:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  informational: 'bg-sky-50 text-sky-700 border-sky-200',
  ignore:        'bg-slate-100 text-slate-500 border-slate-200',
}
const PRIORITY_PILL: Record<string, string> = {
  urgent: 'bg-rose-50 text-rose-700 border-rose-200',
  high:   'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low:    'bg-slate-100 text-slate-500 border-slate-200',
}
const STAGE_LABEL: Record<string, string> = { rule: 'S1', local_model: 'S2', premium_ai: 'S3' }

type Attachment = { id: string; file_name: string; file_size: number; mime_type: string | null; signedUrl: string | null }
type ThreadItem = { id: string; subject: string | null; from_address: string | null; received_at: string | null }

function senderName(addr: string | null): string {
  if (!addr) return '—'
  const m = addr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m && m[1].trim()) return m[1].trim()
  return (m?.[2] ?? addr).trim()
}
function initials(addr: string | null): string {
  const n = senderName(addr)
  const parts = n.split(/[\s.@]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}
const AVATARS = [
  'from-indigo-400 to-purple-500', 'from-emerald-400 to-cyan-500', 'from-amber-400 to-orange-500',
  'from-rose-400 to-fuchsia-500', 'from-sky-400 to-indigo-500', 'from-lime-400 to-emerald-500',
]
function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return AVATARS[Math.abs(h) % AVATARS.length]
}

export function ReviewClient({
  review, attachments, thread, services, teams, isAdmin,
}: {
  review: IntakeReviewDetail
  attachments: Attachment[]
  thread: ThreadItem[]
  services: { id: string; name: string; team_id: string | null }[]
  teams: { id: string; name: string }[]
  profileId: string
  isAdmin: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isEditingClassification, setIsEditingClassification] = useState(false)

  // ── Classification state ──────────────────────────────────────────────────
  const [type, setType] = useState<WorkType>((review.final_type ?? review.suggested_type ?? 'request') as WorkType)
  const [department, setDepartment] = useState<string>(review.final_department ?? review.suggested_department ?? 'unknown')
  const [category, setCategory] = useState<string>(review.final_category ?? review.suggested_category ?? '')
  const [subcategory, setSubcategory] = useState<string>(review.final_subcategory ?? review.suggested_subcategory ?? '')
  const [priority, setPriority] = useState<Priority>((review.final_priority ?? review.suggested_priority ?? 'medium') as Priority)
  const [notes, setNotes] = useState(review.decision_notes ?? '')

  // ── Flag state ────────────────────────────────────────────────────────────
  const [isStarred, setIsStarred] = useState(review.is_starred ?? false)
  const [isEscalated, setIsEscalated] = useState(review.is_escalated ?? false)
  const [escalationNote, setEscalationNote] = useState(review.escalation_note ?? '')
  const [showEscalatePanel, setShowEscalatePanel] = useState(false)

  function handleStar() {
    const next = !isStarred
    setIsStarred(next)
    startTransition(async () => {
      const r = await starReview(review.id, next)
      if (r.error) { setIsStarred(!next); toast.error(r.error) }
    })
  }

  function handleEscalate() {
    if (!isEscalated) {
      setShowEscalatePanel(true)
    } else {
      startTransition(async () => {
        const r = await escalateReview(review.id, false)
        if (r.error) { toast.error(r.error); return }
        setIsEscalated(false)
        setEscalationNote('')
        setShowEscalatePanel(false)
      })
    }
  }

  function handleEscalateSave() {
    startTransition(async () => {
      const r = await escalateReview(review.id, true, escalationNote || undefined)
      if (r.error) { toast.error(r.error); return }
      setIsEscalated(true)
      setShowEscalatePanel(false)
      toast.success('Escalated.')
    })
  }

  // ── Communication state (Phase D.5) ──────────────────────────────────────
  const [isRead, setIsRead] = useState(false)
  const [isArchived, setIsArchived] = useState(false)
  const [sendMode, setSendMode] = useState<SendAction | null>(null)
  const [sendTo, setSendTo] = useState('')
  const [sendSubject, setSendSubject] = useState(`Re: ${review.message?.subject ?? ''}`)
  const [sendBody, setSendBody] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [showNoteBox, setShowNoteBox] = useState(false)

  function handleMarkRead() {
    const next = !isRead
    setIsRead(next)
    startTransition(async () => {
      const r = await markMessageRead(review.message_id, next)
      if (r.error) { toast.error(r.error); setIsRead(!next) }
    })
  }

  function handleArchive() {
    const next = !isArchived
    setIsArchived(next)
    startTransition(async () => {
      const r = await archiveMessage(review.message_id, next)
      if (r.error) { toast.error(r.error); setIsArchived(!next); return }
      toast.success(next ? 'Message archived.' : 'Message unarchived.')
    })
  }

  function openSend(action: SendAction) {
    const fromAddr = review.message?.from_address ?? ''
    const toAddrs  = review.message?.to_addresses ?? []
    if (action === 'reply')     setSendTo(fromAddr)
    if (action === 'reply_all') setSendTo([fromAddr, ...toAddrs].filter(Boolean).join(', '))
    if (action === 'forward')   setSendTo('')
    setSendSubject(action === 'forward' ? `Fwd: ${review.message?.subject ?? ''}` : `Re: ${review.message?.subject ?? ''}`)
    setSendBody('')
    setSendMode(action)
  }

  function handleSend() {
    const to = sendTo.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
    if (!to.length) { toast.error('At least one recipient required.'); return }
    if (!sendSubject.trim()) { toast.error('Subject required.'); return }

    startTransition(async () => {
      const res = await sendFromMessage(review.message_id, {
        action: sendMode!,
        toAddresses: to,
        subject: sendSubject,
        bodyText: sendBody,
      })
      if (!res.ok) { toast.error(res.error ?? 'Send failed.'); return }
      toast.success('Message sent.')
      setSendMode(null)
    })
  }

  function handleAddNote() {
    if (!noteBody.trim()) return
    startTransition(async () => {
      const r = await addNote(review.message_id, noteBody)
      if (r.error) { toast.error(r.error); return }
      toast.success('Note added.')
      setNoteBody('')
      setShowNoteBox(false)
    })
  }

  // ── Work-creation form state ──────────────────────────────────────────────
  const defaultTeamId = review.message?.channel?.default_team_id ?? null
  const [workTitle, setWorkTitle] = useState(review.message?.subject ?? '')
  const [workDescription, setWorkDescription] = useState(
    (review.message?.body_text ?? '').slice(0, 600).trim()
  )
  // Pre-fill from the engine's catalog match (F2); reviewer can still override.
  const [workServiceId, setWorkServiceId] = useState<string>(review.suggested_service_id ?? services[0]?.id ?? '')
  const [workTeamId, setWorkTeamId] = useState<string>(review.suggested_team_id ?? defaultTeamId ?? teams[0]?.id ?? '')

  const isTerminal = ['approved', 'rejected', 'converted'].includes(review.state)
  const isConverted = review.state === 'converted'

  const msg = review.message
  const suggestedDiffers =
    type !== review.suggested_type ||
    (department || null) !== (review.suggested_department ?? null) ||
    priority !== review.suggested_priority

  function decision() {
    return {
      final_type: type,
      final_department: department || null,
      final_category: category || null,
      final_subcategory: subcategory || null,
      final_priority: priority,
      decision_notes: notes || undefined,
    }
  }

  function buildPayload(): WorkPayload {
    if (type === 'ignore')        return { type: 'ignore' }
    if (type === 'informational') return { type: 'informational' }
    if (type === 'task')   return { type: 'task',     title: workTitle, description: workDescription, team_id: workTeamId }
    if (type === 'approval') return { type: 'approval', title: workTitle, description: workDescription, service_id: workServiceId, team_id: workTeamId }
    return { type: 'request', title: workTitle, description: workDescription, service_id: workServiceId, team_id: workTeamId }
  }

  function handleApproveAndCreate() {
    const p = buildPayload()

    if (p.type !== 'ignore' && p.type !== 'informational') {
      if (!workTitle.trim()) { toast.error('Title is required.'); return }
      if ((p.type === 'request' || p.type === 'approval') && !workServiceId) { toast.error('Select a service.'); return }
      if (!workTeamId) { toast.error('Select a team.'); return }
    }

    startTransition(async () => {
      const res = await approveAndCreate(review.id, decision(), p)
      if (!res.ok) { toast.error(res.error); return }
      if (!('workUrl' in res)) {
        toast.success('Review approved — no work item created.')
      } else {
        const label = WORK_TYPE_META[res.workType].label
        const no = 'workNo' in res && res.workNo ? ` #${res.workNo}` : ''
        toast.success(`${label}${no} created.`, {
          action: { label: 'Open', onClick: () => router.push(res.workUrl) },
          duration: 6000,
        })
      }
      router.push('/intake/inbox')
    })
  }

  function handleReject() {
    if (!confirm('Reject (ignore) this message? This cannot be undone.')) return
    startTransition(async () => {
      const res = await rejectReview(review.id, notes || undefined)
      if (res.error) { toast.error(res.error); return }
      toast.success('Message rejected.')
      router.push('/intake/inbox')
    })
  }

  function handleSaveReclassification() {
    const newDecision = {
      final_type: type,
      final_department: department || null,
      final_category: category || null,
      final_subcategory: subcategory || null,
      final_priority: priority,
    }

    startTransition(async () => {
      const res = await reclassifyReview(review.id, newDecision)
      if (!res.ok) { toast.error(res.error); return }
      toast.success('Classification updated.')
      setIsEditingClassification(false)
      router.refresh()
    })
  }

  const workMeta = WORK_TYPE_META[type]
  const isNoWork = NO_WORK_TYPES.includes(type)
  const approveLabel = isNoWork
    ? `Approve as ${workMeta.label}`
    : suggestedDiffers
      ? `Approve & Create ${workMeta.label} (modified)`
      : `Approve & Create ${workMeta.label}`

  const conf = review.suggested_confidence ?? 0
  const fromAddr = msg?.from_address ?? null
  const stage = review.classification?.stage ?? null

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
      {/* ════════ Center: reading pane ════════ */}
      <div className="min-w-0 flex-1 space-y-3">
        {/* Toolbar */}
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => openSend('reply')}
            className="btn-gradient h-8"
          >
            <Reply className="h-3.5 w-3.5" /> Reply
          </button>
          <ActionBtn title="Reply all" onClick={() => openSend('reply_all')}><ReplyAll className="h-3.5 w-3.5" /></ActionBtn>
          <ActionBtn title="Forward" onClick={() => openSend('forward')}><Forward className="h-3.5 w-3.5" /></ActionBtn>
          <span className="mx-1 h-5 w-px bg-border" />
          <ActionBtn title="Add note" onClick={() => setShowNoteBox((v) => !v)}><MessageSquare className="h-3.5 w-3.5" /></ActionBtn>
          <ActionBtn title={isRead ? 'Mark unread' : 'Mark read'} onClick={handleMarkRead}>
            {isRead ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </ActionBtn>
          <ActionBtn title={isArchived ? 'Unarchive' : 'Archive'} onClick={handleArchive} active={isArchived}><Archive className="h-3.5 w-3.5" /></ActionBtn>
          <ActionBtn title={isStarred ? 'Unstar' : 'Star'} onClick={handleStar} active={isStarred}>
            <Star className="h-3.5 w-3.5" fill={isStarred ? 'currentColor' : 'none'} />
          </ActionBtn>
        </div>

        {/* Subject + pills */}
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className={`chip-3d gap-0.5 text-[10px] font-bold capitalize ${PRIORITY_PILL[priority]}`}>
              <Flame className="h-2.5 w-2.5" /> {priority}
            </span>
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold capitalize ${TYPE_PILL[type]}`}>{type}</span>
            {msg?.channel?.name && (
              <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{msg.channel.name}</span>
            )}
            {stage && STAGE_LABEL[stage] && (
              <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{STAGE_LABEL[stage]}</span>
            )}
          </div>
          <h1 className="text-xl font-bold leading-tight text-foreground">{msg?.subject ?? '(no subject)'}</h1>
        </div>

        {/* Sender card */}
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-start gap-3">
            <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-xs font-bold text-white ${avatarColor(fromAddr ?? '?')}`}>
              {initials(fromAddr)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground">{fromAddr ?? '—'}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {msg?.to_addresses?.length ? <>To {msg.to_addresses.join(', ')} · </> : null}
                via {msg?.channel?.name ?? '—'} · {msg?.received_at ? formatRelativeTime(msg.received_at) : '—'}
              </p>
            </div>
            {thread.length > 1 && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {thread.length} in thread
              </span>
            )}
          </div>
        </div>

        {/* AI brief — Gmail-style summary above the body */}
        <AiBrief
          subject={msg?.subject ?? null}
          bodyText={msg?.body_text ?? null}
          fromAddress={fromAddr}
        />

        {/* Compose panel (reply / forward) — Joyful composer */}
        {sendMode && (
          <div className="overflow-hidden rounded-2xl border border-indigo-200 bg-card shadow-sm">
            <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-3 py-2">
              <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold capitalize text-indigo-700">
                {sendMode.replace('_', ' ')}
              </span>
            </div>
            <div className="space-y-2 px-3 py-3">
              <input value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="To" className={selCls} />
              <input value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} placeholder="Subject" className={selCls} />
              <textarea value={sendBody} onChange={(e) => setSendBody(e.target.value)} rows={4} placeholder="Reply…  (press / for AI commands)" className={`${selCls} resize-none`} />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/20 px-3 py-2">
              <button onClick={() => setSendMode(null)} className="btn-soft">Cancel</button>
              <button onClick={handleSend} disabled={isPending}
                className="btn-gradient">
                <Send className="h-3.5 w-3.5" /> Send
              </button>
            </div>
          </div>
        )}

        {/* Internal note box */}
        {showNoteBox && (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Internal note</p>
            <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={3} placeholder="Visible only to your team…" className={`${selCls} bg-white`} />
            <div className="flex gap-2">
              <button onClick={handleAddNote} disabled={isPending || !noteBody.trim()}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">Save note</button>
              <button onClick={() => setShowNoteBox(false)} className="btn-soft">Cancel</button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <EmailBody html={msg?.body_html ?? null} text={msg?.body_text ?? null} />
          {attachments.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Attachments</p>
              <div className="flex flex-wrap gap-2">
                {attachments.map((a) => (
                  <a key={a.id} href={a.signedUrl ?? '#'} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs hover:bg-muted">
                    <Paperclip className="h-3.5 w-3.5" /> {a.file_name}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Thread */}
        {thread.length > 1 && (
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Thread ({thread.length})</p>
            <div className="space-y-1.5">
              {thread.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-xs">
                  <span className={`truncate ${t.id === msg?.id ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                    {t.subject ?? '(no subject)'} — {senderName(t.from_address)}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{t.received_at ? formatRelativeTime(t.received_at) : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ════════ Right: AI intelligence rail ════════ */}
      <div className="w-full space-y-3 lg:w-[340px] lg:shrink-0">

        {/* Converted banner */}
        {isConverted && (review.created_request_id || review.created_task_id) && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-xs font-semibold text-emerald-800">Work item created</p>
            {review.created_request_id && (
              <a href={`/requests/${review.created_request_id}`} className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700 underline">
                Open Request <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {review.created_task_id && (
              isAdmin ? (
                <a href={`/tasks/${review.created_task_id}`} className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700 underline">
                  Open Task <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                // Tasks is Admin/Owner-only for now — /tasks would redirect
                // this viewer to /home, so don't offer a dead-end link.
                <p className="mt-1 text-xs text-emerald-700">Task created</p>
              )
            )}
          </div>
        )}

        {/* Escalation */}
        <div className={`relative overflow-hidden rounded-xl border p-3 ${isEscalated ? 'border-rose-300 bg-gradient-to-br from-rose-50 to-orange-50' : 'border-border bg-card'}`}>
          <div className="flex items-start gap-2.5">
            <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${isEscalated ? 'bg-rose-100' : 'bg-muted'}`}>
              <AlertTriangle className={`h-4 w-4 ${isEscalated ? 'text-rose-600' : 'text-muted-foreground'}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <h3 className={`text-xs font-bold ${isEscalated ? 'text-rose-800' : 'text-foreground'}`}>{isEscalated ? 'Escalated' : 'Escalation'}</h3>
                <button onClick={handleEscalate} disabled={isPending} className={`text-[11px] font-bold hover:underline disabled:opacity-50 ${isEscalated ? 'text-rose-700' : 'text-indigo-600'}`}>
                  {isEscalated ? 'Clear →' : 'Escalate →'}
                </button>
              </div>
              {isEscalated && escalationNote && !showEscalatePanel && (
                <p className="mt-0.5 text-[11px] italic text-rose-700">{escalationNote}</p>
              )}
            </div>
          </div>
          {showEscalatePanel && (
            <div className="mt-2 space-y-2">
              <textarea value={escalationNote} onChange={(e) => setEscalationNote(e.target.value)} rows={2} placeholder="Escalation reason (optional)…" className={`${selCls} resize-none bg-white`} />
              <div className="flex gap-2">
                <button onClick={handleEscalateSave} disabled={isPending} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">Confirm</button>
                <button onClick={() => setShowEscalatePanel(false)} className="btn-soft">Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* Classification */}
        <div className="relative overflow-hidden rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-card to-fuchsia-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-700">
              <Sparkles className="h-3.5 w-3.5" /> Classification
            </span>
            <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${
              conf >= 70 ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : conf >= 40 ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-gray-200 bg-gray-50 text-gray-500'}`}>{conf}% conf</span>
          </div>
          {review.classification?.rationale && (
            <p className="mb-2.5 text-[12px] leading-relaxed text-foreground">{review.classification.rationale}</p>
          )}
          <div className="mb-1 flex justify-between text-[9px] uppercase tracking-wider text-muted-foreground">
            <span>Confidence</span>
            {review.classification?.provider && (
              <span className="font-mono">{review.classification.provider} · {review.classification.stage}</span>
            )}
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-emerald-400" style={{ width: `${conf}%` }} />
          </div>
        </div>

        {/* Auto-drafted form (classification fields) */}
        <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <Zap className="h-3.5 w-3.5 text-amber-600" /> {isEditingClassification ? 'Edit' : 'Auto-drafted'} {workMeta.label}
            </h3>
            {!isTerminal && (
              <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">Ready</span>
            )}
            {isTerminal && !isEditingClassification && (
              <button
                onClick={() => setIsEditingClassification(true)}
                className="text-[10px] font-bold text-indigo-600 hover:underline"
              >
                Edit →
              </button>
            )}
            {isEditingClassification && (
              <div className="flex gap-1">
                <button
                  onClick={handleSaveReclassification}
                  disabled={isPending}
                  className="rounded-md bg-indigo-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => setIsEditingClassification(false)}
                  disabled={isPending}
                  className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          <Field label="Work Type">
            <select value={type} onChange={(e) => setType(e.target.value as WorkType)} disabled={!isEditingClassification && isTerminal} className={selCls}>
              {WORK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Department">
              <select value={department} onChange={(e) => setDepartment(e.target.value)} disabled={!isEditingClassification && isTerminal} className={selCls}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} disabled={!isEditingClassification && isTerminal} className={selCls}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Category">
              <input value={category} onChange={(e) => setCategory(e.target.value)} disabled={!isEditingClassification && isTerminal} placeholder="—" className={selCls} />
            </Field>
            <Field label="Subcategory">
              <input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} disabled={!isEditingClassification && isTerminal} placeholder="—" className={selCls} />
            </Field>
          </div>
          <Field label="Decision notes">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!isEditingClassification && isTerminal} rows={2} placeholder="Optional context for the team…" className={`${selCls} resize-none`} />
          </Field>
        </div>

        {/* Work creation form — hidden for no-work types */}
        {!isTerminal && !isNoWork && (
          <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">
            <div className={`flex items-center gap-1.5 text-xs font-bold ${workMeta.color}`}>
              {workMeta.icon} Create {workMeta.label}
            </div>
            <Field label="Title">
              <input value={workTitle} onChange={(e) => setWorkTitle(e.target.value)} placeholder="Work item title" className={selCls} />
            </Field>
            <Field label="Description">
              <textarea value={workDescription} onChange={(e) => setWorkDescription(e.target.value)} rows={4} placeholder="Description (pre-filled from email)" className={`${selCls} resize-none`} />
            </Field>
            {(type === 'request' || type === 'approval') && (
              <Field label="Service">
                <select value={workServiceId} onChange={(e) => {
                  const id = e.target.value
                  setWorkServiceId(id)
                  const t = services.find((s) => s.id === id)?.team_id
                  if (t) setWorkTeamId(t)
                }} className={selCls}>
                  {services.length === 0 ? <option value="">No active services</option> : services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Team">
              <select value={workTeamId} onChange={(e) => setWorkTeamId(e.target.value)} className={selCls}>
                {teams.length === 0 ? <option value="">No teams</option> : teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            {type === 'approval' && (
              <p className="text-[11px] text-muted-foreground">Creates a request in <span className="font-semibold">pending approval</span> and triggers the service&apos;s approval workflow.</p>
            )}
            {type === 'task' && (
              <p className="text-[11px] text-muted-foreground">Task priority is capped at <span className="font-semibold">high</span> (tasks have no urgent).</p>
            )}
          </div>
        )}

        {/* Actions / CTA */}
        {isTerminal ? (
          <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-center text-xs text-muted-foreground">
            This review is <span className="font-semibold">{review.state}</span>.{' '}
            {isConverted ? 'Work item created above.' : 'No further action.'}
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={handleApproveAndCreate}
              disabled={isPending}
              className={`flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold shadow-md transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50 ${
                isNoWork
                  ? 'bg-muted text-muted-foreground shadow-none hover:bg-muted/80'
                  : 'bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-indigo-500/30'
              }`}
            >
              <Sparkles className="h-4 w-4" /> {approveLabel}
            </button>
            <button
              onClick={handleReject}
              disabled={isPending}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
            >
              <X className="h-4 w-4" /> Reject (discard)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const selCls = 'w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none transition focus:border-indigo-300 disabled:opacity-60 capitalize'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

function ActionBtn({
  title, onClick, active, children,
}: { title: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg border text-muted-foreground transition hover:bg-muted hover:text-foreground ${active ? 'border-border bg-muted text-foreground' : 'border-border bg-card'}`}
    >
      {children}
    </button>
  )
}
