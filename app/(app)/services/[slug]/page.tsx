import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Clock, Users, ShieldCheck } from 'lucide-react'
import { getServiceBySlug, getAllowedSubCategoriesForService } from '@/lib/queries/services'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getRequesterServiceShortcuts } from '@/lib/queries/requests'
import { createClient } from '@/lib/supabase/server'
import { ServiceRequestWorkspace } from '@/components/requests/ServiceRequestWorkspace'
import { CategoryIcon } from '@/components/admin/CategoryIcon'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function ServiceDetailPage({ params }: PageProps) {
  const { slug } = await params
  const [service, profile] = await Promise.all([getServiceBySlug(slug), getCurrentProfile()])

  if (!service) notFound()

  const allowedSubCategories = await getAllowedSubCategoriesForService(service.id)

  // For any `store_address`-type field on this service's template — shown
  // read-only, re-derived and enforced independently server-side in
  // createRequest() regardless of what (if anything) reaches the client.
  let currentUserStoreAddress: string | null = null
  if (profile?.store_id) {
    const supabase = await createClient()
    const { data: store } = await supabase.from('stores').select('address').eq('id', profile.store_id).maybeSingle()
    currentUserStoreAddress = store?.address ?? null
  }

  // "Book on behalf of" — only agents/managers can raise a request for someone
  // else; a plain requester submitting for themselves never sees this option.
  const canBookOnBehalf =
    !!profile &&
    (profile.role === 'agent' ||
      profile.role === 'manager' ||
      profile.role === 'admin' ||
      profile.role === 'platform_owner')

  const defaultSla = service.sla_policy?.config?.[service.default_priority]

  // Personal, service-scoped shortcuts — explicitly the signed-in operator's
  // own history (never whoever "Requesting on behalf of" is currently set
  // to; see ServiceRequestWorkspace/DynamicForm — the picker only affects
  // who the request is filed for, not whose shortcuts are shown). Skipped
  // entirely for a logged-out render (shouldn't normally happen behind the
  // (app) layout's auth gate, but keeps this page's own logic total).
  const shortcuts = profile
    ? await getRequesterServiceShortcuts(profile.id, service.id, allowedSubCategories)
    : { recent: [], frequent: [] }

  return (
    <div className="mx-auto max-w-[1680px] space-y-4">
      {/* Breadcrumb */}
      <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Link href="/services" className="hover:text-foreground transition-colors">Services</Link>
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span className="text-foreground font-medium">{service.name}</span>
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span className="text-foreground font-medium">Create Request</span>
      </nav>

      {/* Compact service header */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <CategoryIcon
            icon={service.icon}
            iconImageUrl={service.icon_image_url}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg"
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold tracking-tight text-foreground">{service.name}</h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Users className="h-3 w-3" />
              {service.team.name}
            </span>
            {defaultSla?.resolution_hours != null && (
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

      {/* Universal 3-panel workspace — service context | the real DynamicForm | personal shortcuts */}
      <ServiceRequestWorkspace
        service={service}
        canBookOnBehalf={canBookOnBehalf}
        allowedSubCategories={allowedSubCategories}
        currentUserStoreAddress={currentUserStoreAddress}
        description={service.description}
        slaConfig={service.sla_policy?.config ?? null}
        recent={shortcuts.recent}
        frequent={shortcuts.frequent}
      />
    </div>
  )
}
