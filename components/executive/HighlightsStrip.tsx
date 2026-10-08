'use client'

import { AlertTriangle, ArrowUpRight, Clock, Flame, Layers } from 'lucide-react'
import type { Highlight, Severity } from '@/lib/reporting/executive/highlights'

const TONE: Record<Severity, { bar: string; kicker: string; hover: string; icon: React.ReactNode }> = {
  critical: { bar: 'bg-destructive', kicker: 'text-destructive', hover: 'hover:border-destructive/50', icon: <Flame className="h-4 w-4 shrink-0 text-destructive" /> },
  warning: { bar: 'bg-warning', kicker: 'text-warning', hover: 'hover:border-warning/50', icon: <AlertTriangle className="h-4 w-4 shrink-0 text-warning" /> },
  info: { bar: 'bg-primary', kicker: 'text-primary', hover: 'hover:border-primary/50', icon: <Layers className="h-4 w-4 shrink-0 text-primary" /> },
  action: { bar: 'bg-info', kicker: 'text-info', hover: 'hover:border-info/50', icon: <Clock className="h-4 w-4 shrink-0 text-info" /> },
}

/** Four plain-language signals that need attention. Each opens the drill-down pop-up on the right slice. */
export function HighlightsStrip({ items, total, onOpen }: { items: Highlight[]; total: number; onOpen: (h: Highlight) => void }) {
  return (
    <section aria-label="Priority intelligence highlights" className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Priority intelligence &amp; bottleneck highlights</h2>
          <span className="text-border" aria-hidden>·</span>
          <span className="text-xs text-muted-foreground">Click a highlight to open the drill-down pop-up, down to a single ticket</span>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{items.length} signals across {total} ticket{total === 1 ? '' : 's'}</span>
      </div>
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 2xl:grid-cols-4">
        {items.map((h) => {
          const t = TONE[h.severity]
          return (
            <button
              key={h.id} type="button" onClick={() => onOpen(h)}
              className={`group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${t.hover}`}
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${t.bar}`} aria-hidden />
              <div className="space-y-2 pl-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {t.icon}
                    <span className={`truncate text-[11px] font-semibold uppercase tracking-wide ${t.kicker}`}>{h.category}</span>
                  </span>
                  <span className={`shrink-0 text-xs font-semibold tabular-nums ${t.kicker}`}>{h.keyStat}</span>
                </div>
                <h3 className="text-sm font-semibold leading-snug text-foreground">{h.headline}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground">{h.detail}</p>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-border pl-1.5 pt-3 text-xs font-medium text-foreground group-hover:text-primary">
                <span>{h.actionLabel}</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
