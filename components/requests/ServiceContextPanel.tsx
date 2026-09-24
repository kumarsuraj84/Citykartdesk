'use client'

import { Clock } from 'lucide-react'
import type { RequesterServiceShortcut } from '@/lib/queries/requests'
import type { SLAConfig } from '@/types'

const SLA_TIER_ORDER: (keyof SLAConfig)[] = ['urgent', 'high', 'medium', 'low']

function formatHours(h: number | null | undefined): string {
  if (h == null) return '—'
  if (h < 1) return `${Math.round(h * 60)} min`
  return `${h % 1 === 0 ? h : h.toFixed(1)} hour${h === 1 ? '' : 's'}`
}

function ShortcutRow({ item, onClick }: { item: RequesterServiceShortcut; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <span className="truncate">{item.subCategoryName}</span>
      <span className="shrink-0 text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100">&rsaquo;</span>
    </button>
  )
}

/** Left panel of the Create Request workspace — service description, its SLA
 *  targets, and the signed-in requester's own Recently Used sub-categories
 *  for this service. Entirely data-driven off the `service` object and the
 *  shortcuts query — nothing here is specific to any one service. */
export function ServiceContextPanel({
  serviceName,
  description,
  slaConfig,
  recent,
  onShortcutClick,
}: {
  serviceName: string
  description: string | null
  slaConfig: SLAConfig | null | undefined
  recent: RequesterServiceShortcut[]
  onShortcutClick: (item: RequesterServiceShortcut) => void
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">About {serviceName}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description || 'No description configured for this service yet.'}
        </p>
      </div>

      {slaConfig && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <Clock className="h-3 w-3" /> SLA Targets
          </h3>
          <div className="space-y-1">
            {SLA_TIER_ORDER.map((tier) => {
              const cfg = slaConfig[tier]
              if (!cfg) return null
              return (
                <div key={tier} className="flex items-center justify-between border-t border-border/60 py-1.5 text-xs first:border-t-0">
                  <span className="font-semibold capitalize text-foreground">{tier}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatHours(cfg.response_hours)} / {formatHours(cfg.resolution_hours)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-2">
        <h3 className="px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Recently Used</h3>
        {recent.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground/70">No recent requests yet for this service.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {recent.map((item) => (
              <ShortcutRow key={item.subCategoryId} item={item} onClick={() => onShortcutClick(item)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
