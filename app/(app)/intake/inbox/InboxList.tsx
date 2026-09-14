'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Inbox, Mail, Search, ChevronLeft, ChevronRight,
  ClipboardList, CheckCircle2, ShieldCheck, CheckCheck, Archive,
  Star, AlertTriangle, Flame, MessageSquare,
} from 'lucide-react'
import type { InboxMessage, IntakeChannel } from '@/lib/queries/intake'
import { starReview } from '@/lib/actions/intake/flags'
import { formatRelativeTime } from '@/lib/utils'

const STAGE_META: Record<string, { label: string; cls: string }> = {
  rule:        { label: 'S1', cls: 'bg-muted text-muted-foreground border-border' },
  local_model: { label: 'S2', cls: 'bg-primary/10 text-primary border-primary/20' },
  premium_ai:  { label: 'S3', cls: 'bg-info/10 text-info border-info/20' },
}
// Classifier-stage filter for the toolbar — slice the inbox by which pipeline
// stage produced the classification (S1 rules / S2 model / S3 premium).
const STAGE_FILTERS: { key: string; label: string }[] = [
  { key: 'all',         label: 'All' },
  { key: 'rule',        label: 'S1' },
  { key: 'local_model', label: 'S2' },
  { key: 'premium_ai',  label: 'S3' },
]
const PRIORITY_WEIGHT: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 }

type SortKey = 'priority_smart' | 'date_desc' | 'date_asc' | 'confidence_desc' | 'confidence_asc'
const PAGE_SIZE = 50

type Folder = { key: string; label: string; icon: React.ReactNode; match: (m: InboxMessage) => boolean }

const FOLDERS: Folder[] = [
  { key: 'all',       label: 'All',          icon: <Inbox className="h-4 w-4" />,          match: (m) => !m.is_archived },
  { key: 'urgent',    label: 'Urgent',        icon: <Flame className="h-4 w-4" />,          match: (m) => !m.is_archived && (m.review?.suggested_priority === 'urgent' || m.review?.is_escalated === true) },
  { key: 'starred',   label: 'Starred',       icon: <Star className="h-4 w-4" />,           match: (m) => !m.is_archived && m.review?.is_starred === true },
  { key: 'escalated', label: 'Escalated',     icon: <AlertTriangle className="h-4 w-4" />,  match: (m) => !m.is_archived && m.review?.is_escalated === true },
  { key: 'unread',    label: 'Unread',        icon: <Mail className="h-4 w-4" />,           match: (m) => !m.is_archived && !m.is_read },
  // ── by type (the primary actionable work) ──
  { key: 'request',   label: 'Requests',      icon: <ClipboardList className="h-4 w-4" />,  match: (m) => !m.is_archived && m.review?.suggested_type === 'request' },
  { key: 'task',      label: 'Tasks',         icon: <CheckCircle2 className="h-4 w-4" />,   match: (m) => !m.is_archived && m.review?.suggested_type === 'task' },
  { key: 'approval',  label: 'Approvals',     icon: <ShieldCheck className="h-4 w-4" />,    match: (m) => !m.is_archived && m.review?.suggested_type === 'approval' },
  // ── lifecycle ──
  { key: 'converted', label: 'Converted',     icon: <CheckCheck className="h-4 w-4" />,     match: (m) => !m.is_archived && m.review?.state === 'converted' },
  // Everything else — informational/junk FYI mail, archived, and not-yet-classified.
  // Folds the old Information + Archived buckets into one low-priority catch-all.
  { key: 'rest',      label: 'Rest',          icon: <Archive className="h-4 w-4" />,        match: (m) => m.is_archived || m.review?.suggested_type === 'informational' || m.review?.suggested_type === 'ignore' || !m.review },
]

function senderLabel(addr: string | null): string {
  if (!addr) return '—'
  const m = addr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m && m[1].trim()) return m[1].trim()
  return (m?.[2] ?? addr).trim()
}

function initials(addr: string | null): string {
  const n = senderLabel(addr)
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
const TYPE_PILL: Record<string, string> = {
  request:       'bg-primary/10 text-primary border-primary/20',
  task:          'bg-warning/10 text-warning border-warning/20',
  approval:      'bg-success/10 text-success border-success/20',
  informational: 'bg-info/10 text-info border-info/20',
  ignore:        'bg-muted text-muted-foreground border-border',
}
const PRIORITY_PILL: Record<string, string> = {
  urgent: 'bg-destructive/10 text-destructive border-destructive/20',
  high:   'bg-warning/10 text-warning border-warning/20',
  medium: 'bg-warning/10 text-warning border-warning/20',
  low:    'bg-muted text-muted-foreground border-border',
}

// Age badge for pending/in_review items only (not for resolved mail).
function ageBadge(receivedAt: string | null, state: string | null) {
  if (!receivedAt || (state !== 'pending' && state !== 'in_review')) return null
  const ageH = (Date.now() - new Date(receivedAt).getTime()) / 3_600_000
  if (ageH >= 48) return { cls: 'bg-destructive/10 text-destructive border-destructive/20', label: `${Math.floor(ageH / 24)}d` }
  if (ageH >= 8)  return { cls: 'bg-warning/10 text-warning border-warning/20', label: `${Math.floor(ageH)}h` }
  return null
}

function priorityScore(m: InboxMessage, isEscalated: boolean): number {
  const pw = PRIORITY_WEIGHT[m.review?.suggested_priority ?? 'medium'] ?? 2
  return pw * 10 + (isEscalated ? 5 : 0) + (m.review?.is_starred ? 2 : 0)
}

export function InboxList({
  messages, channels, initialFolder, initialChannel, onOpen, activeMessageId,
}: {
  messages: InboxMessage[]
  channels: IntakeChannel[]
  initialFolder?: string
  initialChannel?: string
  // Workspace (3-pane) mode: emit selection inline instead of navigating.
  onOpen?: (reviewId: string | null, messageId: string) => void
  activeMessageId?: string | null
}) {
  const workspace = typeof onOpen === 'function'
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [folder, setFolder] = useState(() => (FOLDERS.some(f => f.key === initialFolder) ? initialFolder! : 'all'))
  const [selectedChannel, setSelectedChannel] = useState<string | null>(initialChannel ?? null)
  const [search, setSearch] = useState('')
  const [sort, setSort]     = useState<SortKey>('priority_smart')
  const [stage, setStage]   = useState<string>('all')
  const [page, setPage]     = useState(1)
  // Optimistic star overrides — key: reviewId, value: starred state
  const [starOverrides, setStarOverrides] = useState<Map<string, boolean>>(new Map())

  // Thread groups: thread_id → count of pending/in_review messages in the thread
  const threadPendingCount = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const m of messages) {
      if (!m.thread_id) continue
      if (m.review?.state === 'pending' || m.review?.state === 'in_review') {
        counts[m.thread_id] = (counts[m.thread_id] ?? 0) + 1
      }
    }
    return counts
  }, [messages])

  // Effective starred state (optimistic overrides win)
  function effectiveStarred(m: InboxMessage): boolean {
    if (!m.review) return false
    return starOverrides.has(m.review.id) ? (starOverrides.get(m.review.id) ?? false) : (m.review.is_starred ?? false)
  }
  function effectiveEscalated(m: InboxMessage): boolean {
    return m.review?.is_escalated ?? false
  }

  // Live counts per folder
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const f of FOLDERS) c[f.key] = 0
    for (const m of messages) for (const f of FOLDERS) if (f.match(m)) c[f.key]++
    return c
  }, [messages])

  const activeFolder = FOLDERS.find(f => f.key === folder) ?? FOLDERS[0]

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = messages.filter((m) => {
      if (!activeFolder.match(m)) return false
      if (selectedChannel && m.channel?.id !== selectedChannel) return false
      if (stage !== 'all' && m.review?.stage !== stage) return false
      if (q) {
        const hay = `${m.subject ?? ''} ${m.from_address ?? ''} ${m.review?.suggested_department ?? ''} ${m.channel?.name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    rows = [...rows].sort((a, b) => {
      switch (sort) {
        case 'priority_smart': {
          const diff = priorityScore(b, effectiveEscalated(b)) - priorityScore(a, effectiveEscalated(a))
          if (diff !== 0) return diff
          return (b.received_at ?? '').localeCompare(a.received_at ?? '')
        }
        case 'date_asc':  return (a.received_at ?? '').localeCompare(b.received_at ?? '')
        case 'date_desc': return (b.received_at ?? '').localeCompare(a.received_at ?? '')
        case 'confidence_desc': return (b.review?.suggested_confidence ?? -1) - (a.review?.suggested_confidence ?? -1)
        case 'confidence_asc':  return (a.review?.suggested_confidence ?? 999) - (b.review?.suggested_confidence ?? 999)
      }
    })
    return rows
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeFolder, search, sort, stage, starOverrides, selectedChannel])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const selectFolder = (key: string) => {
    setFolder(key)
    setPage(1)
    const url = new URL(window.location.href)
    url.searchParams.set('folder', key)
    router.push(url.toString().replace(url.origin, ''))
  }

  const selectChannel = (channelId: string | null) => {
    setSelectedChannel(channelId)
    setPage(1)
    const url = new URL(window.location.href)
    if (channelId) {
      url.searchParams.set('channel', channelId)
    } else {
      url.searchParams.delete('channel')
    }
    router.push(url.toString().replace(url.origin, ''))
  }

  function handleStar(e: React.MouseEvent, reviewId: string, current: boolean) {
    e.stopPropagation()
    const next = !current
    setStarOverrides(prev => new Map(prev).set(reviewId, next))
    startTransition(async () => {
      const r = await starReview(reviewId, next)
      if (r.error) {
        // Roll back optimistic update on error
        setStarOverrides(prev => new Map(prev).set(reviewId, current))
      }
    })
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* ── Folder rail (hidden in workspace mode — filters move atop the list) ── */}
      <aside className={`lg:w-52 lg:shrink-0 ${workspace ? 'hidden' : ''}`}>
        <div className="space-y-2">
          <nav className="flex gap-1.5 overflow-x-auto rounded-xl border border-border bg-card p-2 lg:flex-col lg:overflow-visible">
            {FOLDERS.map((f) => {
              const active = f.key === folder
              const isDivider = f.key === 'request' || f.key === 'converted' || f.key === 'unread'
              return (
                <div key={f.key} className="contents">
                  {isDivider && <div className="hidden lg:my-1 lg:block lg:border-t lg:border-border" />}
                  <button
                    onClick={() => selectFolder(f.key)}
                    className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <span className={active ? 'text-primary' : 'text-muted-foreground/70'}>{f.icon}</span>
                    <span className="flex-1 text-left">{f.label}</span>
                    {counts[f.key] > 0 && (
                      <span className={`rounded-full px-1.5 text-[10px] font-semibold ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                        {counts[f.key]}
                      </span>
                    )}
                  </button>
                </div>
              )
            })}
          </nav>

          {/* ── Mailboxes section ── */}
          {channels.length > 0 && (
            <nav className="hidden rounded-xl border border-border bg-card p-2 lg:block">
              <div className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mailboxes</div>
              <button
                onClick={() => selectChannel(null)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  selectedChannel === null ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <span className={selectedChannel === null ? 'text-primary' : 'text-muted-foreground/70'}><Inbox className="h-4 w-4" /></span>
                <span>All mailboxes</span>
              </button>
              {channels.map((ch) => {
                const active = selectedChannel === ch.id
                const channelMessages = messages.filter(m => m.channel?.id === ch.id)
                const statusColor = ch.status === 'error' ? 'text-rose-600' : ch.status === 'paused' ? 'text-amber-600' : 'text-emerald-600'
                const statusLabel = ch.status === 'active' ? 'Connected' : ch.status === 'paused' ? 'Paused' : 'Error'
                return (
                  <button
                    key={ch.id}
                    onClick={() => selectChannel(ch.id)}
                    className={`flex w-full flex-col gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                      active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                    title={ch.status === 'error' ? `Error: ${ch.last_error}` : ''}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 ${active ? 'text-primary' : statusColor}`}>
                        <Mail className="h-4 w-4" />
                      </span>
                      <span className="flex-1 truncate text-left font-medium">{ch.name}</span>
                      {channelMessages.length > 0 && (
                        <span className={`rounded-full px-1.5 text-[10px] font-semibold ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>
                          {channelMessages.length}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 px-6">
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        ch.status === 'error' ? 'bg-rose-600' : ch.status === 'paused' ? 'bg-amber-600' : 'bg-emerald-600'
                      }`} />
                      <span className={`text-[10px] ${statusColor}`}>{statusLabel}</span>
                      {ch.last_error && <span className="text-[10px] text-rose-600">— {ch.last_error}</span>}
                    </div>
                  </button>
                )
              })}
            </nav>
          )}
        </div>
      </aside>

      {/* ── List ── */}
      <div className="min-w-0 flex-1 space-y-2">
        {/* Filter tabs (workspace mode folds folders to the top of the list) */}
        {workspace && (
          <div className="space-y-2">
            <nav className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1.5">
              {FOLDERS.map((f) => {
                const active = f.key === folder
                return (
                  <button
                    key={f.key}
                    onClick={() => selectFolder(f.key)}
                    className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                      active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {f.icon}
                    <span>{f.label}</span>
                    {counts[f.key] > 0 && (
                      <span className={`rounded-full px-1.5 text-[10px] font-bold ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{counts[f.key]}</span>
                    )}
                  </button>
                )
              })}
            </nav>
            <div className="flex flex-wrap items-center gap-2">
              {/* Mailbox buttons (replaces the dropdown) */}
              {channels.length > 1 && (
                <div className="flex flex-wrap items-center gap-1">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  <button
                    onClick={() => selectChannel(null)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      selectedChannel === null ? 'bg-primary/10 text-primary' : 'border border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    All mailboxes
                  </button>
                  {channels.map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => selectChannel(ch.id)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        selectedChannel === ch.id ? 'bg-primary/10 text-primary' : 'border border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {ch.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Stage filter (S1/S2/S3) — slice by classifier */}
              <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
                {STAGE_FILTERS.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => { setStage(s.key); setPage(1) }}
                    title={s.key === 'rule' ? 'Stage 1 — rules' : s.key === 'local_model' ? 'Stage 2 — model' : s.key === 'premium_ai' ? 'Stage 3 — premium AI' : 'All stages'}
                    className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors ${
                      stage === s.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {/* Toolbar */}
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search subject, sender, dept…"
              className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{filtered.length} message{filtered.length === 1 ? '' : 's'}</span>
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value as SortKey); setPage(1) }}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground outline-none focus:border-primary"
            >
              <option value="priority_smart">Priority (smart)</option>
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="confidence_desc">Confidence high→low</option>
              <option value="confidence_asc">Confidence low→high</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
            <Inbox className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-semibold text-foreground">Nothing here</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {messages.length === 0 ? 'Inbound messages appear here once ingested.' : 'No messages in this folder match your search.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {pageRows.map((m, i) => {
              const unread = !m.is_read
              const r = m.review
              const href = r?.id ? `/intake/review/${r.id}` : `/intake/inbox/${m.id}`
              const starred = effectiveStarred(m)
              const escalated = effectiveEscalated(m)
              const age = ageBadge(m.received_at, r?.state ?? null)
              const threadCount = m.thread_id ? (threadPendingCount[m.thread_id] ?? 0) : 0
              const isCC = m.recipient_type === 'cc'
              const conf = r?.suggested_confidence
              const prio = r?.suggested_priority ?? ''

              const isActive = workspace && activeMessageId === m.id

              return (
                <div
                  key={m.id}
                  onClick={() => (workspace ? onOpen!(r?.id ?? null, m.id) : router.push(href))}
                  className={`relative flex cursor-pointer gap-3 px-4 py-3 transition-colors hover:bg-muted/30 ${
                    i < pageRows.length - 1 ? 'border-b border-border' : ''
                  } ${isActive ? 'bg-primary/10' : escalated ? 'bg-destructive/10' : unread ? 'bg-primary/5' : ''}`}
                >
                  {(isActive || unread || escalated) && (
                    <span className={`absolute left-0 top-2.5 bottom-2.5 w-0.5 rounded-r-full ${isActive || escalated ? (isActive ? 'bg-primary' : 'bg-destructive') : 'bg-primary/60'}`} />
                  )}

                  {/* Avatar + star */}
                  <div className="flex flex-col items-center gap-1 pt-0.5">
                    <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-[10px] font-bold text-white ${avatarColor(m.from_address ?? '?')}`}>
                      {initials(m.from_address)}
                    </div>
                    {r?.id && (
                      <button
                        title={starred ? 'Unstar' : 'Star'}
                        onClick={(e) => handleStar(e, r.id, starred)}
                        className={`transition-colors ${starred ? 'text-amber-400' : 'text-muted-foreground/30 hover:text-amber-400'}`}
                      >
                        <Star className="h-3 w-3" fill={starred ? 'currentColor' : 'none'} />
                      </button>
                    )}
                  </div>

                  {/* Body — sender·time, subject, preview snippet, then a single badge row */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className={`min-w-0 flex-1 truncate text-[12px] ${unread ? 'font-bold text-foreground' : 'font-semibold text-muted-foreground'}`}>
                        {senderLabel(m.from_address)}
                      </p>
                      <span className="shrink-0 text-[10px] text-muted-foreground" title={m.received_at ? new Date(m.received_at).toLocaleString('en-US', { hour12: false }) : ''} suppressHydrationWarning>
                        {m.received_at ? formatRelativeTime(m.received_at) : ''}
                      </span>
                    </div>

                    <p className={`mt-0.5 truncate text-[13px] leading-snug ${unread ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}>
                      {m.subject ?? '(no subject)'}
                    </p>

                    {m.snippet && (
                      <p className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground">{m.snippet}</p>
                    )}

                    <div className="mt-1.5 flex items-center gap-1 overflow-hidden">
                      {channels.length > 1 && m.channel && (
                        <span className="shrink-0 rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold text-primary">{m.channel.name}</span>
                      )}
                      {r?.suggested_type && (
                        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold capitalize ${TYPE_PILL[r.suggested_type] ?? 'border-slate-200 bg-slate-100 text-slate-500'}`}>{r.suggested_type}</span>
                      )}
                      {prio && (
                        <span className={`chip-3d shrink-0 gap-0.5 text-[9px] font-bold capitalize ${PRIORITY_PILL[prio] ?? 'text-slate-500'}`}>
                          <Flame className="h-2.5 w-2.5" />{prio}
                        </span>
                      )}
                      {r?.stage && STAGE_META[r.stage] && (
                        <span title={`Classified by ${r.provider ?? r.stage}`} className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold ${STAGE_META[r.stage].cls}`}>{STAGE_META[r.stage].label}</span>
                      )}
                      {escalated && (
                        <span title={r?.escalation_note ?? 'Escalated'} className="shrink-0 rounded border border-destructive/20 bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold text-destructive">↑ esc</span>
                      )}
                      {isCC && <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">CC</span>}
                      {threadCount > 1 && (
                        <span title={`${threadCount} unresolved in this thread`} className="inline-flex shrink-0 items-center gap-0.5 rounded border border-warning/20 bg-warning/10 px-1.5 py-0.5 text-[9px] font-bold text-warning">
                          <MessageSquare className="h-2.5 w-2.5" />{threadCount}
                        </span>
                      )}
                      {age && <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold ${age.cls}`}>{age.label}</span>}
                      {conf != null && (
                        <span className={`ml-auto shrink-0 font-mono text-[10px] font-semibold ${
                          conf >= 70 ? 'text-success' : conf >= 40 ? 'text-warning' : 'text-muted-foreground'
                        }`}>{conf}%</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                <span>Page {safePage} of {totalPages}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage <= 1}
                    className="btn-soft disabled:opacity-40">
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
                    className="btn-soft disabled:opacity-40">
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
