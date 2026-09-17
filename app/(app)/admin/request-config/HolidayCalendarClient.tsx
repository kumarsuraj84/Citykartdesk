'use client'

import { useState } from 'react'
import { createHoliday, deleteHoliday } from '@/lib/actions/admin/config'

type Holiday = {
  id: string
  name: string
  date: string
  is_recurring: boolean
}

export function HolidayCalendarClient({ initialHolidays }: { initialHolidays: Holiday[] }) {
  const [holidays, setHolidays] = useState<Holiday[]>(initialHolidays)
  const [form, setForm] = useState({ name: '', date: '', is_recurring: false })
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  async function handleAdd() {
    if (!form.name.trim() || !form.date) { setError('Name and date are required.'); return }
    setAdding(true)
    setError('')
    const result = await createHoliday(form)
    setAdding(false)
    if (result.error || !result.data) { setError(result.error ?? 'Failed to create holiday.'); return }
    const created = result.data
    // Use the server-returned row (real id, server-normalized fields) rather than
    // fabricating one client-side — crypto.randomUUID() is unavailable outside a
    // secure context (e.g. plain HTTP on a LAN IP), which crashed this handler.
    setHolidays((prev) => [...prev, created])
    setForm({ name: '', date: '', is_recurring: false })
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    const result = await deleteHoliday(id)
    setDeleting(null)
    if (result.error) { setError(result.error); return }
    setHolidays((prev) => prev.filter((h) => h.id !== id))
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_140px_100px_80px] border-b border-border bg-muted/30 px-4 py-2.5 gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Name</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recurring</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"></span>
        </div>
        {holidays.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">No holidays configured.</div>
        )}
        {holidays.map((h) => (
          <div key={h.id} className="grid grid-cols-[1fr_140px_100px_80px] items-center border-b border-border/50 last:border-0 px-4 py-3 gap-3">
            <span className="text-sm text-foreground">{h.name}</span>
            <span className="text-sm text-muted-foreground">{h.date}</span>
            <div>
              {h.is_recurring && (
                <span className="rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
                  Recurring
                </span>
              )}
            </div>
            <button
              onClick={() => handleDelete(h.id)}
              disabled={deleting === h.id}
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              {deleting === h.id ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground">Add Holiday</h3>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Christmas Day"
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm w-48"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 pb-0.5">
            <input
              type="checkbox"
              id="recurring"
              checked={form.is_recurring}
              onChange={(e) => setForm((f) => ({ ...f, is_recurring: e.target.checked }))}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <label htmlFor="recurring" className="text-sm text-foreground">Recurring annually</label>
          </div>
          <button
            onClick={handleAdd}
            disabled={adding}
            className="btn-gradient"
          >
            {adding ? 'Adding…' : 'Add Holiday'}
          </button>
        </div>
      </div>
    </div>
  )
}
