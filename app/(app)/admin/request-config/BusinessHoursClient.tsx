'use client'

import { useState } from 'react'
import { updateBusinessHours } from '@/lib/actions/admin/config'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type BusinessHourRow = {
  id: string
  day_of_week: number
  start_time: string
  end_time: string
  is_active: boolean
}

export function BusinessHoursClient({ initialRows }: { initialRows: BusinessHourRow[] }) {
  const [rows, setRows] = useState<BusinessHourRow[]>(
    DAY_NAMES.map((_, i) => {
      const found = initialRows.find((r) => r.day_of_week === i)
      return found ?? { id: '', day_of_week: i, start_time: '09:00', end_time: '17:00', is_active: i >= 1 && i <= 5 }
    })
  )
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [status, setStatus] = useState<Record<number, { ok?: boolean; msg?: string }>>({})

  function updateRow(dow: number, patch: Partial<BusinessHourRow>) {
    setRows((prev) => prev.map((r) => (r.day_of_week === dow ? { ...r, ...patch } : r)))
  }

  async function handleSave(dow: number) {
    const row = rows[dow]
    setSaving((s) => ({ ...s, [dow]: true }))
    setStatus((s) => ({ ...s, [dow]: {} }))
    const result = await updateBusinessHours(dow, {
      start_time: row.start_time,
      end_time: row.end_time,
      is_active: row.is_active,
    })
    setSaving((s) => ({ ...s, [dow]: false }))
    if (result.error) {
      setStatus((s) => ({ ...s, [dow]: { ok: false, msg: result.error } }))
    } else {
      setStatus((s) => ({ ...s, [dow]: { ok: true, msg: 'Saved' } }))
      setTimeout(() => setStatus((s) => ({ ...s, [dow]: {} })), 2000)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="grid grid-cols-[120px_80px_120px_120px_80px_80px] border-b border-border bg-muted/30 px-4 py-2.5 gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Day</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Active</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">End</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"></span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"></span>
      </div>
      {rows.map((row) => (
        <div
          key={row.day_of_week}
          className="grid grid-cols-[120px_80px_120px_120px_80px_80px] items-center border-b border-border/50 last:border-0 px-4 py-3 gap-3"
        >
          <span className="text-sm font-medium text-foreground">{DAY_NAMES[row.day_of_week]}</span>
          <div>
            <input
              type="checkbox"
              checked={row.is_active}
              onChange={(e) => updateRow(row.day_of_week, { is_active: e.target.checked })}
              className="h-4 w-4 rounded border-border accent-primary"
            />
          </div>
          <input
            type="time"
            value={row.start_time.slice(0, 5)}
            onChange={(e) => updateRow(row.day_of_week, { start_time: e.target.value })}
            disabled={!row.is_active}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-40"
          />
          <input
            type="time"
            value={row.end_time.slice(0, 5)}
            onChange={(e) => updateRow(row.day_of_week, { end_time: e.target.value })}
            disabled={!row.is_active}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-40"
          />
          <button
            onClick={() => handleSave(row.day_of_week)}
            disabled={saving[row.day_of_week]}
            className="btn-gradient"
          >
            {saving[row.day_of_week] ? 'Saving…' : 'Save'}
          </button>
          <span className={`text-xs ${status[row.day_of_week]?.ok === false ? 'text-red-600' : 'text-green-600'}`}>
            {status[row.day_of_week]?.msg ?? ''}
          </span>
        </div>
      ))}
    </div>
  )
}
