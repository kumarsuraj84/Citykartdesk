'use client'

import { useMemo, useState, useTransition } from 'react'
import { Check, Search, AlertTriangle } from 'lucide-react'
import { upsertFieldSlaOverride } from '@/lib/actions/admin/sla-matrix'
import type { FieldSlaMatrixRow } from '@/lib/sla/matrix'

type Priority = 'urgent' | 'high' | 'medium' | 'low'

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low']
const PRIORITY_LABELS: Record<Priority, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' }

type Tier = { response_hours: number | null; resolution_hours: number | null }

type MatrixItem = {
  service_id: string
  service_name: string
  category_name: string
  sub_category_name: string | null
  field_id: string
  field_label: string
  option_value: string
  option_label: string
  tiers: Record<Priority, Tier>
}

function itemKey(r: Pick<FieldSlaMatrixRow, 'service_id' | 'field_id' | 'option_value'>): string {
  return `${r.service_id}::${r.field_id}::${r.option_value}`
}

function groupIntoItems(rows: FieldSlaMatrixRow[]): MatrixItem[] {
  const byKey = new Map<string, MatrixItem>()
  for (const row of rows) {
    const key = itemKey(row)
    let item = byKey.get(key)
    if (!item) {
      item = {
        service_id: row.service_id,
        service_name: row.service_name,
        category_name: row.category_name,
        sub_category_name: row.sub_category_name,
        field_id: row.field_id,
        field_label: row.field_label,
        option_value: row.option_value,
        option_label: row.option_label,
        tiers: { urgent: { response_hours: null, resolution_hours: null }, high: { response_hours: null, resolution_hours: null }, medium: { response_hours: null, resolution_hours: null }, low: { response_hours: null, resolution_hours: null } },
      }
      byKey.set(key, item)
    }
    item.tiers[row.priority] = { response_hours: row.response_hours, resolution_hours: row.resolution_hours }
  }
  return Array.from(byKey.values())
}

interface HoursInputProps {
  item: MatrixItem
  priority: Priority
  field: 'response_hours' | 'resolution_hours'
}

function HoursInput({ item, priority, field }: HoursInputProps) {
  const initial = item.tiers[priority][field]
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
      setError('Invalid number.')
      return
    }

    const tier = item.tiers[priority]
    const responseHours = field === 'response_hours' ? nextParsed : tier.response_hours
    const resolutionHours = field === 'resolution_hours' ? nextParsed : tier.resolution_hours
    // Catch it client-side before the round trip — the server (upsert_field_sla_override)
    // enforces the same rule as the source of truth, this is just faster feedback.
    if (responseHours != null && resolutionHours != null && resolutionHours <= responseHours) {
      setError('Resolution SLA must be greater than Response SLA.')
      return
    }

    startTransition(async () => {
      const result = await upsertFieldSlaOverride({
        serviceId: item.service_id,
        fieldId: item.field_id,
        fieldLabel: item.field_label,
        optionValue: item.option_value,
        optionLabel: item.option_label,
        priority,
        responseHours,
        resolutionHours,
      })
      if (result.error) {
        setError(result.error)
        return
      }
      tier[field] = nextParsed
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
        className={`w-full rounded-md border bg-background px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 ${
          error ? 'border-red-400' : 'border-border'
        }`}
      />
      {saved && <Check className="pointer-events-none absolute -right-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-500" />}
      {error && (
        <div className="absolute left-0 top-full z-10 mt-1 w-max max-w-[220px] rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 shadow-sm">
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          {error}
        </div>
      )}
    </div>
  )
}

function MatrixItemRow({ item }: { item: MatrixItem }) {
  const [priority, setPriority] = useState<Priority>('urgent')
  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-muted/20">
      <td className="px-3 py-2 text-foreground">{item.category_name}</td>
      <td className="px-3 py-2 text-muted-foreground">{item.sub_category_name ?? '—'}</td>
      <td className="px-3 py-2">
        <span className="text-foreground">{item.option_label}</span>
        <span className="block text-xs text-muted-foreground/70">
          {item.service_name} · {item.field_label}
        </span>
      </td>
      <td className="px-3 py-2">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <HoursInput key={`${itemKey(item)}::${priority}::response`} item={item} priority={priority} field="response_hours" />
      </td>
      <td className="px-3 py-2">
        <HoursInput key={`${itemKey(item)}::${priority}::resolution`} item={item} priority={priority} field="resolution_hours" />
      </td>
    </tr>
  )
}

const ALL = '__all__'

export function FieldSlaMatrixClient({ rows }: { rows: FieldSlaMatrixRow[] }) {
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState(ALL)
  const [subCategoryFilter, setSubCategoryFilter] = useState(ALL)

  const items = useMemo(() => groupIntoItems(rows), [rows])

  const categories = useMemo(
    () => Array.from(new Set(items.map((r) => r.category_name))).sort(),
    [items]
  )
  const subCategories = useMemo(() => {
    const inScope = categoryFilter === ALL ? items : items.filter((r) => r.category_name === categoryFilter)
    return Array.from(new Set(inScope.map((r) => r.sub_category_name).filter((n): n is string => !!n))).sort()
  }, [items, categoryFilter])

  function handleCategoryChange(next: string) {
    setCategoryFilter(next)
    // Reset sub-group whenever it no longer belongs to the newly selected group.
    if (next !== ALL) {
      const stillValid = items.some((r) => r.category_name === next && r.sub_category_name === subCategoryFilter)
      if (!stillValid) setSubCategoryFilter(ALL)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((r) => {
      if (categoryFilter !== ALL && r.category_name !== categoryFilter) return false
      if (subCategoryFilter !== ALL && r.sub_category_name !== subCategoryFilter) return false
      if (!q) return true
      return [r.service_name, r.category_name, r.sub_category_name ?? '', r.field_label, r.option_label]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [items, query, categoryFilter, subCategoryFilter])

  if (items.length === 0) {
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
          {filtered.length} of {items.length} field values
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full min-w-[760px] border-collapse text-sm">
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
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Type of Priority
              </th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Response SLA (hrs)
              </th>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Resolution SLA (hrs)
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <MatrixItemRow key={itemKey(item)} item={item} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
