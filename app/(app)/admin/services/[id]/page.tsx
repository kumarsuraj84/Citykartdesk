import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Layers } from 'lucide-react'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getServiceById, getActiveFormTemplatesForPicker } from '@/lib/queries/services'
import { getFieldIdsWithSlaOverrides } from '@/lib/sla/matrix'
import { resolveFormSections } from '@/lib/forms/sections'
import { SectionBuilder } from '@/components/admin/SectionBuilder'
import { ServiceTemplateTag } from '@/components/admin/ServiceTemplateTag'
import { saveFormSections } from '@/lib/actions/admin/services'
import type { FormSection } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AdminServiceEditorPage({ params }: PageProps) {
  const { id } = await params

  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const [service, fieldIdsWithSla, templates] = await Promise.all([
    getServiceById(id),
    getFieldIdsWithSlaOverrides(id),
    getActiveFormTemplatesForPicker(),
  ])
  if (!service) notFound()

  const isTagged = Boolean(service.template_id && service.template)

  // ── Resolve initial sections (untagged/legacy path only — a tagged
  // service's fields live on the template, edited from its own page) ────────
  const existingSections =
    Array.isArray(service.form_sections) && service.form_sections.length > 0
      ? (service.form_sections as unknown as FormSection[])
      : null

  const initialSections: FormSection[] = resolveFormSections(service)
  const isMigrated = !existingSections && initialSections.length > 0

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link
          href="/admin/services"
          className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Form Builder
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="font-medium text-foreground">{service.name}</span>
      </nav>

      {/* Service identity card */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-lg">
          {service.icon ?? '📋'}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
            {service.name}
          </h1>
          <p className="text-xs text-muted-foreground">
            {service.category.name} · {service.team.name}
            {!service.is_active && ' · Inactive'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
          <Layers className="h-3 w-3" />
          Form Builder
        </div>
      </div>

      {/* Template tag — always shown; drives whether the builder below is editable */}
      <ServiceTemplateTag
        serviceId={service.id}
        currentTemplate={isTagged ? { id: service.template!.id, name: service.template!.name } : null}
        templates={templates}
        hasOwnForm={initialSections.length > 0}
      />

      {isTagged ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            This service&rsquo;s form is managed by its tagged template — open the template above to edit fields.
          </p>
        </div>
      ) : (
        <>
          {/* Migration notice */}
          {isMigrated && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-900">Legacy fields pre-loaded</p>
              <p className="mt-0.5 text-xs text-amber-700">
                Fields have been pre-loaded into a &ldquo;Request Details&rdquo; section. Saving will
                activate the section-based format — the original flat fields remain stored but are no
                longer used.
              </p>
            </div>
          )}

          {/* Builder — untagged/legacy services still build their own form */}
          <SectionBuilder
            entityName={service.name}
            initialSections={initialSections}
            onSave={saveFormSections.bind(null, service.id)}
            fieldIdsWithSla={fieldIdsWithSla}
          />
        </>
      )}
    </div>
  )
}
