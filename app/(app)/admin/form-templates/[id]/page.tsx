import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, FileText } from 'lucide-react'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getFormTemplateById } from '@/lib/queries/services'
import { saveTemplateSections } from '@/lib/actions/admin/form-templates'
import { SectionBuilder } from '@/components/admin/SectionBuilder'
import type { FormSection } from '@/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AdminFormTemplateEditorPage({ params }: PageProps) {
  const { id } = await params

  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') redirect('/home')

  const template = await getFormTemplateById(id)
  if (!template) notFound()

  const initialSections = Array.isArray(template.form_sections)
    ? (template.form_sections as unknown as FormSection[])
    : []

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <nav className="flex items-center gap-1.5 text-sm">
        <Link
          href="/admin/form-templates"
          className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Form Templates
        </Link>
        <span className="text-muted-foreground/40">/</span>
        <span className="font-medium text-foreground">{template.name}</span>
      </nav>

      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <FileText className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
            {template.name}
          </h1>
          {template.description && (
            <p className="text-xs text-muted-foreground">{template.description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
          <FileText className="h-3 w-3" />
          Template Builder
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-xs text-amber-700">
          Saving here immediately changes what every service tagged to this template renders next — already-submitted requests are unaffected.
        </p>
      </div>

      <SectionBuilder
        entityName={template.name}
        initialSections={initialSections}
        onSave={saveTemplateSections.bind(null, template.id)}
      />
    </div>
  )
}
