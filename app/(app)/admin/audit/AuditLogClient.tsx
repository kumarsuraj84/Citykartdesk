'use client'

import { useState } from 'react'
import { Download, ChevronDown, Copy, Check } from 'lucide-react'
import type { AuditEntry } from '@/lib/queries/admin'
import type { Profile } from '@/types'

interface AuditLogClientProps {
  initialEntries: AuditEntry[]
  profiles: Pick<Profile, 'id' | 'full_name'>[]
}

const ENTITY_BADGE_STYLE: Record<AuditEntry['entity_type'], string> = {
  request: 'bg-blue-100 text-blue-700',
  task: 'bg-purple-100 text-purple-700',
  service: 'bg-amber-100 text-amber-700',
  service_category: 'bg-amber-100 text-amber-700',
  service_sub_category: 'bg-amber-100 text-amber-700',
}

function EntityBadge({ type }: { type: AuditEntry['entity_type'] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ENTITY_BADGE_STYLE[type]}`}
    >
      {type.replace(/_/g, ' ')}
    </span>
  )
}

// DESK-UI-012 — audit entries cover dozens of distinct `action` strings
// (action is a free-form string set at each of the many logActivity/
// logTaskActivity call sites across the app, not a fixed enum), so a
// per-action-type summary map isn't practical to build and keep complete.
// Instead this recognizes a handful of common metadata *shapes* that
// recur across most actions (a from/to transition, a lone reason, a lone
// step number) and otherwise falls back to a readable "Key: value" list —
// still a real improvement over a raw JSON blob for anyone scanning the
// table, without needing to know every action type in advance. Full
// fidelity is preserved regardless: AuditDetailsCell below always keeps
// the exact raw JSON one click away.
function humanizeKey(key: string): string {
  const spaced = key.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function humanizeValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function metadataSummary(meta: Record<string, unknown>): string {
  const keys = Object.keys(meta)
  if (keys.length === 0) return '—'

  if ('from' in meta && 'to' in meta) {
    return `Changed from "${humanizeValue(meta.from)}" to "${humanizeValue(meta.to)}"`
  }
  if (keys.length === 1 && 'reason' in meta) {
    return `Reason: ${humanizeValue(meta.reason)}`
  }
  if (keys.length === 1 && 'step' in meta) {
    return `Step ${humanizeValue(meta.step)}`
  }

  const parts = keys.slice(0, 4).map((k) => `${humanizeKey(k)}: ${humanizeValue(meta[k])}`)
  const summary = parts.join(' · ') + (keys.length > 4 ? ' · …' : '')
  return summary.length > 110 ? summary.slice(0, 107) + '…' : summary
}

/** Concise human-readable summary by default, with the exact raw JSON one
 *  click away (expand + copy) — so nothing about the audit trail's
 *  fidelity is lost, only its default presentation. */
function AuditDetailsCell({ metadata }: { metadata: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const hasMetadata = Object.keys(metadata).length > 0
  const raw = JSON.stringify(metadata, null, 2)

  async function copyRaw() {
    try {
      await navigator.clipboard.writeText(raw)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard access denied — no-op, the raw JSON is still visible to select/copy manually */
    }
  }

  return (
    <div className="max-w-xs">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-600 truncate">{metadataSummary(metadata)}</span>
        {hasMetadata && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
          >
            {expanded ? 'Hide' : 'View details'}
          </button>
        )}
      </div>
      {expanded && (
        <div className="relative mt-1.5 rounded-md border border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={copyRaw}
            title="Copy raw payload"
            className="absolute right-1.5 top-1.5 rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all p-2 pr-7 font-mono text-[11px] text-gray-700">
            {raw}
          </pre>
        </div>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function AuditLogClient({ initialEntries, profiles }: AuditLogClientProps) {
  const [entries, setEntries] = useState<AuditEntry[]>(initialEntries)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(initialEntries.length === 50)
  const [loading, setLoading] = useState(false)

  // Filter state
  const [entityType, setEntityType] = useState<'all' | 'request' | 'task' | 'catalog'>('all')
  const [actorId, setActorId] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  async function applyFilters() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (entityType !== 'all') params.set('entityType', entityType)
      if (actorId) params.set('actorId', actorId)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      params.set('perPage', '50')
      params.set('page', '1')

      const res = await fetch(`/api/admin/audit?${params.toString()}`)
      if (res.ok) {
        const json = await res.json()
        setEntries(json.data ?? [])
        setPage(1)
        setHasMore((json.data ?? []).length === 50)
      }
    } finally {
      setLoading(false)
    }
  }

  async function loadMore() {
    setLoading(true)
    try {
      const nextPage = page + 1
      const params = new URLSearchParams()
      if (entityType !== 'all') params.set('entityType', entityType)
      if (actorId) params.set('actorId', actorId)
      if (dateFrom) params.set('dateFrom', dateFrom)
      if (dateTo) params.set('dateTo', dateTo)
      params.set('perPage', '50')
      params.set('page', String(nextPage))

      const res = await fetch(`/api/admin/audit?${params.toString()}`)
      if (res.ok) {
        const json = await res.json()
        const newEntries = json.data ?? []
        setEntries((prev) => [...prev, ...newEntries])
        setPage(nextPage)
        setHasMore(newEntries.length === 50)
      }
    } finally {
      setLoading(false)
    }
  }

  function exportCSV() {
    const headers = ['Timestamp', 'Entity Type', 'Entity Title', 'Action', 'Actor', 'Metadata']
    const rows = entries.map((e) => [
      e.created_at,
      e.entity_type,
      e.entity_title ?? e.entity_id,
      e.action,
      e.actor_name,
      JSON.stringify(e.metadata),
    ])
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Entity Type</label>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as 'all' | 'request' | 'task' | 'catalog')}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All</option>
            <option value="request">Requests</option>
            <option value="task">Tasks</option>
            <option value="catalog">Service Catalog</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Actor</label>
          <select
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Actors</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Date From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Date To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <button
          onClick={applyFilters}
          disabled={loading}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Apply
        </button>

        <div className="ml-auto">
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Timestamp
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Entity
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Action
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Actor
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">
                  No audit log entries found.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-gray-500">
                    {formatDate(entry.created_at)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-col gap-1">
                      <EntityBadge type={entry.entity_type} />
                      <span className="text-xs text-gray-700 leading-tight">
                        {entry.entity_title ?? entry.entity_id}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-800">
                      {entry.action}
                    </code>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-700">
                    {entry.actor_name}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    <AuditDetailsCell metadata={entry.metadata} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <ChevronDown className="h-4 w-4" />
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  )
}
