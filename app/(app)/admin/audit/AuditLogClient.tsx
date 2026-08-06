'use client'

import { useState } from 'react'
import { Download, ChevronDown } from 'lucide-react'
import type { AuditEntry } from '@/lib/queries/admin'
import type { Profile } from '@/types'

interface AuditLogClientProps {
  initialEntries: AuditEntry[]
  profiles: Pick<Profile, 'id' | 'full_name'>[]
}

function EntityBadge({ type }: { type: 'request' | 'task' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        type === 'request'
          ? 'bg-blue-100 text-blue-700'
          : 'bg-purple-100 text-purple-700'
      }`}
    >
      {type}
    </span>
  )
}

function metadataSummary(meta: Record<string, unknown>): string {
  const str = JSON.stringify(meta)
  if (str.length <= 80) return str
  return str.slice(0, 77) + '...'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AuditLogClient({ initialEntries, profiles }: AuditLogClientProps) {
  const [entries, setEntries] = useState<AuditEntry[]>(initialEntries)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(initialEntries.length === 50)
  const [loading, setLoading] = useState(false)

  // Filter state
  const [entityType, setEntityType] = useState<'all' | 'request' | 'task'>('all')
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
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Entity Type</label>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as 'all' | 'request' | 'task')}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All</option>
            <option value="request">Requests</option>
            <option value="task">Tasks</option>
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
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Timestamp
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Entity
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Action
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                Actor
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
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
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                    {formatDate(entry.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <EntityBadge type={entry.entity_type} />
                      <span className="text-xs text-gray-700 leading-tight">
                        {entry.entity_title ?? entry.entity_id}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-800">
                      {entry.action}
                    </code>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                    {entry.actor_name}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 font-mono max-w-xs truncate">
                    {metadataSummary(entry.metadata)}
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
