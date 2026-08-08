'use client'

import { useState } from 'react'

export interface DateRange { from: string; to: string }

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - (days - 1))
  return d.toISOString().slice(0, 10)
}

export function lastDaysRange(days: number): DateRange {
  return { from: isoDaysAgo(days), to: isoDaysAgo(1) }
}

const TODAY = isoDaysAgo(1)

const PRESETS = [
  { label: '7d',  days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

// Preset buttons + a plain from/to calendar pair — mirrors the custom-range
// pattern already used on /admin/reports, rather than pulling in a
// popover/calendar library for a second date-range control.
export function DateRangeControl({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  const [fromInput, setFromInput] = useState(range.from)
  const [toInput, setToInput] = useState(range.to)

  const activePreset = PRESETS.find((p) => {
    const r = lastDaysRange(p.days)
    return r.from === range.from && r.to === range.to
  })

  function applyCustom(e: React.FormEvent) {
    e.preventDefault()
    if (!fromInput || !toInput || fromInput > toInput) return
    onChange({ from: fromInput, to: toInput })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              const r = lastDaysRange(p.days)
              setFromInput(r.from)
              setToInput(r.to)
              onChange(r)
            }}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
              activePreset?.label === p.label ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={applyCustom}
        className={`flex items-center gap-1.5 rounded-lg border p-0.5 pl-2.5 ${!activePreset ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/40'}`}
      >
        <input
          type="date"
          value={fromInput}
          max={toInput || TODAY}
          onChange={(e) => setFromInput(e.target.value)}
          className="bg-transparent text-xs text-foreground outline-none"
        />
        <span className="text-xs text-muted-foreground">–</span>
        <input
          type="date"
          value={toInput}
          min={fromInput || undefined}
          max={TODAY}
          onChange={(e) => setToInput(e.target.value)}
          className="bg-transparent text-xs text-foreground outline-none"
        />
        <button type="submit" className="rounded-md bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm hover:bg-card transition-colors">
          Apply
        </button>
      </form>
    </div>
  )
}
