'use client'

import { useRef, useState } from 'react'
import { DynamicForm, type DynamicFormHandle } from '@/components/forms/DynamicForm'
import { ServiceContextPanel } from './ServiceContextPanel'
import { RequestShortcutPanel } from './RequestShortcutPanel'
import type { RequesterServiceShortcut } from '@/lib/queries/requests'
import type { AllowedSubCategory, SLAConfig, ServiceWithRelations } from '@/types'

/**
 * The universal Create Request workspace — left service context, center the
 * real unmodified <DynamicForm>, right personalized shortcuts. Works for any
 * service because everything here comes from the service/shortcuts data
 * passed in, never a hard-coded slug/name check.
 *
 * Desktop: 3 columns (22% / 1fr / 23%, or 26%/1fr when there are no
 * shortcuts to show at all — see hasAnyShortcuts below). Collapses to a
 * single column below `xl` (1280px) — `lg` (1024px) still has significant
 * app-shell sidebar width eating into the content area, so 3 columns there
 * reads cramped; confirmed visually during the design review.
 */
export function ServiceRequestWorkspace({
  service,
  canBookOnBehalf,
  allowedSubCategories,
  currentUserStoreAddress,
  description,
  slaConfig,
  recent,
  frequent,
}: {
  service: ServiceWithRelations
  canBookOnBehalf?: boolean
  allowedSubCategories: AllowedSubCategory[]
  currentUserStoreAddress: string | null
  description: string | null
  slaConfig: SLAConfig | null | undefined
  recent: RequesterServiceShortcut[]
  frequent: RequesterServiceShortcut[]
}) {
  const formRef = useRef<DynamicFormHandle>(null)
  const formAnchorRef = useRef<HTMLDivElement>(null)
  const confirmationTimeout = useRef<number | undefined>(undefined)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  function handleShortcutClick(item: RequesterServiceShortcut) {
    formRef.current?.applyCategoryShortcut(item.categoryId, item.subCategoryId)
    setConfirmation(`${item.subCategoryName} selected`)
    window.clearTimeout(confirmationTimeout.current)
    confirmationTimeout.current = window.setTimeout(() => setConfirmation(null), 2500)
    // The category/sub-category pickers sit at the top of the form — bring
    // them into view on narrow screens where the workspace may be taller
    // than the viewport (the shortcut panels themselves can be well below).
    formAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const hasAnyShortcuts = recent.length > 0 || frequent.length > 0

  return (
    <div
      className={
        hasAnyShortcuts
          ? 'grid grid-cols-1 gap-4 xl:grid-cols-[22%_1fr_23%] xl:items-start'
          : 'grid grid-cols-1 gap-4 xl:grid-cols-[26%_1fr] xl:items-start'
      }
    >
      {/* LEFT — service context */}
      <div className="order-2 xl:order-1">
        <ServiceContextPanel
          serviceName={service.name}
          description={description}
          slaConfig={slaConfig}
          recent={recent}
          onShortcutClick={handleShortcutClick}
        />
      </div>

      {/* CENTER — real, unmodified DynamicForm */}
      <div ref={formAnchorRef} className="order-1 rounded-xl border border-border bg-card xl:order-2">
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Ticket Description</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Fill in the details below to submit your request to the {service.team.name} team.
            </p>
          </div>
          {confirmation && (
            <span className="shrink-0 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white">
              ✓ {confirmation}
            </span>
          )}
        </div>
        <div className="px-6 py-6">
          <DynamicForm
            ref={formRef}
            service={service}
            canBookOnBehalf={canBookOnBehalf}
            allowedSubCategories={allowedSubCategories}
            currentUserStoreAddress={currentUserStoreAddress}
          />
        </div>
      </div>

      {/* RIGHT — personalized shortcuts only */}
      {frequent.length > 0 && (
        <div className="order-3">
          <RequestShortcutPanel frequent={frequent} onShortcutClick={handleShortcutClick} />
        </div>
      )}
    </div>
  )
}
