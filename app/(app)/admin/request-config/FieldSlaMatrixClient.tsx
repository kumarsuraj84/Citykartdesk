'use client'

import { useMemo, useState, useTransition } from 'react'
import { Check, Search, AlertTriangle } from 'lucide-react'
import { upsertFieldSlaOverride } from '@/lib/actions/admin/sla-matrix'
import type { FieldSlaMatrixRow } from '@/lib/sla/matrix'

const PRIORITY_COLUMNS: { key: 'urgent' | 'high' | 'medium' | 'low'; label: string; cls: string }[] = [
  { key: 'urgent', label: 'CRITICAL', cls: 'text-red-600' },
  { key: 'high', label: 'HIGH', cls: 'text-orange-600' },
  { key: 'medium', label: 'MED', cls: 'text-blue-600' },
  { key: 'low', label: 'LOW', cls: 'text-slate-600' },
]

function rowKey(r: Pick<FieldSlaMatrixRow, 'service_id' | 'field_id' | 'option_value'>): string {
  return `${r.service_id}::${r.field_id}::${r.option_value}`
}

interface CellProps {
  row: FieldSlaMatrixRow
  priority: (typeof PRIORITY_COLUMNS)[number]['key']
}

function HoursCell({ row, priority }: CellProps) {
  const initial = row.sla_config?.[priority]?.resolution_hours
  const [value, setValue] = useState(initial != null ? String(initial) : '')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleBlur() {
    setError(null)
    const nextRaw = value.trim()
    const nextParsed = nextRaw ? parseFloat(nextRaw) : null
    const prevRaw = initial != null ? String(initial) : ''
    if (nextRaw === prevRaw) return
    if (nextParsed != null && (Number.isNaN(nextParsed) || nextParsed < 0)) {
      setError('Invalid')
      return
    }
    startTransition(async () => {
      const result = await upsertFieldSlaOverride({
        serviceId: row.service_id,
        fieldId: row.field_id,
        fieldLabel: row.field_label,
        optionValue: row.option_value,
        optionLabel: row.option_label,
        priority,
        resolutionHours: nextParsed,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <div className="relative">
      <input
        type="number"
        min="0"
        step="0.5"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        placeholder="—"
        disabled={isPending}
        title={error ?? undefined}
        className={`w-full rounded-md border bg-background px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 ${
          error ? 'border-red-400' : 'border-border'
        }`}
      />
      {saved && <Check className="pointer-events-none absolute -right-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-500" />}
      {error && <AlertTriangle className="pointer-events-none absolute -right-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-red-500" />}
    </div>
  )
}

const ALL = '__all__'

export function FieldSlaMatrixClient({ rows }: { rows: FieldSlaMatrixRow[] }) {
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState(ALL)
  const [subCategoryFilter, setSubCategoryFilter] = useState(ALL)

  const categories = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category_name))).sort(),
    [rows]
  )
  const subCategories = useMemo(() => {
    const inScope = categoryFilter === ALL ? rows : rows.filter((r) => r.category_name === categoryFilter)
    return Array.from(new Set(inScope.map((r) => r.sub_category_name).filter((n): n is string => !!n))).sort()
  }, [rows, categoryFilter])

  function handleCategoryChange(next: string) {
    setCategoryFilter(next)
    // Reset sub-group whenever it no longer belongs to the newly selected group.
    if (next !== ALL) {
      const stillValid = rows.some((r) => r.category_name === next && r.sub_category_name === subCategoryFilter)
      if (!stillValid) setSubCategoryFilter(ALL)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (categoryFilter !== ALL && r.category_name !== categoryFilter) return false
      if (subCategoryFilter !== ALL && r.sub_category_name !== subCategoryFilter) return false
      if (!q) return true
      return [r.service_name, r.category_name, r.sub_category_name ?? '', r.field_label, r.option_label]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [rows, query, categoryFilter, subCategoryFilter])

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        No dropdown, multi-select, or radio fields found on any service yet. Add one from a service&apos;s intake
        form builder to start configuring field-level SLA hours here.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by service, field, or value…"
            className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => handleCategoryChange(e.target.value)}
          className="rounded-lg border border-border bg-background py-1.5 px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value={ALL}>All Service Groups</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={subCategoryFilter}
          onChange={(e) => setSubCategoryFilter(e.target.value)}
          className="rounded-lg border border-border bg-background py-1.5 px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value={ALL}>All Sub Groups</option>
          {subCategories.map((sc) => (
            <option key={sc} value={sc}>
              {sc}
            </option>
          ))}
        </select>
        {(categoryFilter !== ALL || subCategoryFilter !== ALL || query) && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setCategoryFilter(ALL)
              setSubCategoryFilter(ALL)
            }}
            className="text-xs text-primary hover:underline"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {rows.length} rows
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Service Group
              </th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Service Sub Group
              </th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Field / Value
              </th>
              {PRIORITY_COLUMNS.map((p) => (
                <th
                  key={p.key}
                  className={`px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide ${p.cls}`}
                >
                  {p.label} (hrs)
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border/50 last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2 text-foreground">{row.category_name}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.sub_category_name ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className="text-foreground">{row.option_label}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground/70">
                    ({row.service_name} · {row.field_label})
                  </span>
                </td>
                {PRIORITY_COLUMNS.map((p) => (
                  <td key={p.key} className="px-3 py-2">
                    <HoursCell row={row} priority={p.key} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
