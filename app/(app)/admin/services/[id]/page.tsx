import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, Layers } from 'lucide-react'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getServiceById, getActiveFormTemplatesForPicker } from '@/lib/queries/services'
import { resolveFormSections } from '@/lib/forms/sections'
import { ServiceTemplateTag } from '@/components/admin/ServiceTemplateTag'
import type { FormSection } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AdminServiceEditorPage({ params }: PageProps) {
  const { id } = await params

  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const [service, templates] = await Promise.all([
    getServiceById(id),
    getActiveFormTemplatesForPicker(),
  ])
  if (!service) notFound()

  const isTagged = Boolean(service.template_id && service.template)

  // Read-only only — Service Catalog no longer builds forms. Untagged/legacy
  // services keep rendering whatever they already have (fully working for
  // requesters), but the only way to change it is "Convert to template"
  // below, which moves it onto the editable Form Templates system.
  const initialSections: FormSection[] = resolveFormSections(service)

  return (
    <div className="mx-auto max-w-[900px] space-y-5">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm">
        <Link
          href="/admin/services"
          className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Service Catalog
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
            {service.category.name}
            {service.sub_category ? ` → ${service.sub_category.name}` : ''} · {service.team.name}
            {!service.is_active && ' · Inactive'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
          <Layers className="h-3 w-3" />
          Form
        </div>
      </div>

      {/* Template tag — the only place a service's form is configured now */}
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
      ) : initialSections.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Current fields (read-only)
          </p>
          {initialSections.map((section) => (
            <div key={section.id} className="rounded-xl border border-border bg-card">
              <div className="border-b border-border bg-muted/30 px-4 py-2">
                <p className="text-xs font-semibold text-foreground">{section.title}</p>
              </div>
              <ul className="divide-y divide-border">
                {[...section.fields]
                  .sort((a, b) => a.order - b.order)
                  .map((field) => (
                    <li key={field.id} className="flex items-center justify-between px-4 py-2 text-xs">
                      <span className="text-foreground">{field.label}</span>
                      <span className="text-muted-foreground">{field.type}{field.required ? ' · Required' : ''}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Service Catalog no longer edits forms directly — use &ldquo;Convert to template&rdquo; above to make these fields editable.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            This service has no submitted-form fields. Tag a template above to give it one.
          </p>
        </div>
      )}
    </div>
  )
}
