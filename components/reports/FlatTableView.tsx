'use client'

import type { ReportRow } from '@/lib/queries/reporting'
import { labelForFieldValue, type ReportField } from '@/lib/reporting/field-registry'

function formatCell(v: string | number | boolean | null, field: ReportField): string {
  if (v === null || v === undefined || v === '') return '—'
  if (field.type === 'boolean') return v === true || v === 'true' ? 'Yes' : 'No'
  if (field.type === 'date') return String(v).slice(0, 10)
  if (field.type === 'enum') return labelForFieldValue(field, v)
  if (field.type === 'number' && typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2)
  return String(v)
}

export function FlatTableView({
  rows, columns,
}: {
  rows: ReportRow[]
  columns: ReportField[]
}) {
  if (columns.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Add at least one column to see data.
      </div>
    )
  }

  return (
    <div className="overflow-auto rounded-lg border border-border bg-card max-h-[70vh]">
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 z-10 bg-primary text-primary-foreground">
          <tr>
            <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide w-10">#</th>
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap border-l border-white/15">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/60 hover:bg-muted/30">
              <td className="px-2 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
              {columns.map((c) => (
                <td key={c.key} className="px-3 py-1.5 text-xs text-foreground whitespace-nowrap">
                  {formatCell(row[c.key], c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
