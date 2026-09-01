import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Clock, Users, ShieldCheck } from 'lucide-react'
import { getServiceBySlug, getAllowedSubCategoriesForService } from '@/lib/queries/services'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { DynamicForm } from '@/components/forms/DynamicForm'
import { CategoryIcon } from '@/components/admin/CategoryIcon'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function ServiceDetailPage({ params }: PageProps) {
  const { slug } = await params
  const [service, profile] = await Promise.all([getServiceBySlug(slug), getCurrentProfile()])

  if (!service) notFound()

  const allowedSubCategories = await getAllowedSubCategoriesForService(service.id)

  // "Book on behalf of" — only agents/managers can raise a request for someone
  // else; a plain requester submitting for themselves never sees this option.
  const canBookOnBehalf =
    !!profile &&
    (profile.role === 'agent' ||
      profile.role === 'manager' ||
      profile.role === 'admin' ||
      profile.role === 'platform_owner')

  const defaultSla = service.sla_policy?.config?.[service.default_priority]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Link href="/services" className="hover:text-foreground transition-colors">Services</Link>
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span className="text-foreground font-medium">{service.name}</span>
      </nav>

      {/* Service header card */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-4">
          <CategoryIcon
            icon={service.icon}
            iconImageUrl={service.icon_image_url}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl"
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{service.name}</h1>
            {service.description && (
              <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{service.description}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                <Users className="h-3 w-3" />
                {service.team.name}
              </span>
              {defaultSla?.resolution_hours && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {defaultSla.resolution_hours}h resolution target
                </span>
              )}
              {service.approval_workflow && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                  <ShieldCheck className="h-3 w-3" />
                  Requires approval
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Form card */}
      <div className="rounded-xl border border-border bg-card">
        {/* Form header */}
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">Ticket Description</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Fill in the details below to submit your request to the {service.team.name} team.
          </p>
        </div>

        {/* Form body */}
        <div className="px-6 py-6">
          <DynamicForm service={service} canBookOnBehalf={canBookOnBehalf} allowedSubCategories={allowedSubCategories} />
        </div>
      </div>
    </div>
  )
}
