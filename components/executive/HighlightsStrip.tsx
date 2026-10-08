'use client'

import { AlertTriangle, ArrowUpRight, Clock, Flame, Layers } from 'lucide-react'
import type { Highlight, Severity } from '@/lib/reporting/executive/highlights'

const TONE: Record<Severity, { bar: string; kicker: string; hover: string; icon: React.ReactNode }> = {
  critical: { bar: 'bg-destructive', kicker: 'text-destructive', hover: 'hover:border-destructive/50', icon: <Flame className="h-3.5 w-3.5 shrink-0 text-destructive" /> },
  warning: { bar: 'bg-warning', kicker: 'text-warning', hover: 'hover:border-warning/50', icon: <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" /> },
  info: { bar: 'bg-primary', kicker: 'text-primary', hover: 'hover:border-primary/50', icon: <Layers className="h-3.5 w-3.5 shrink-0 text-primary" /> },
  action: { bar: 'bg-info', kicker: 'text-info', hover: 'hover:border-info/50', icon: <Clock className="h-3.5 w-3.5 shrink-0 text-info" /> },
}

/** Four short signals (one headline and one line of detail each). A click opens the drill-down pop-up on the right slice. */
export function HighlightsStrip({ items, total, onOpen }: { items: Highlight[]; total: number; onOpen: (h: Highlight) => void }) {
  return (
    <section aria-label="Priority intelligence highlights" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Priority highlights <span className="font-normal normal-case tracking-normal">· click one to drill down to a single ticket</span>
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground">{items.length} signals across {total} ticket{total === 1 ? '' : 's'}</span>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((h) => {
          const t = TONE[h.severity]
          return (
            <button
              key={h.id} type="button" onClick={() => onOpen(h)} title={h.actionLabel}
              className={`group relative overflow-hidden rounded-lg border border-border bg-card py-2.5 pl-4 pr-3 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${t.hover}`}
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${t.bar}`} aria-hidden />
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  {t.icon}
                  <span className={`truncate text-[10.5px] font-bold uppercase tracking-wide ${t.kicker}`}>{h.category}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className={`text-[11px] font-semibold tabular-nums ${t.kicker}`}>{h.keyStat}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                </span>
              </div>
              <h3 className="mt-1 text-[13px] font-semibold leading-snug text-foreground">{h.headline}</h3>
              <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground" title={h.detail}>{h.detail}</p>
            </button>
          )
        })}
      </div>
    </section>
  )
}
