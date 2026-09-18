import { notFound, redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getIntakeReview } from '@/lib/queries/intake'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/PageHeader'
import { ReviewClient } from './ReviewClient'

const INTAKE_ROLES = ['agent', 'manager', 'admin', 'platform_owner']

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function IntakeReviewPage({ params }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!INTAKE_ROLES.includes(profile.role)) redirect('/home')

  const { id } = await params
  const admin = createAdminClient()

  // services/teams use the admin client (bypasses RLS) since this page reads
  // org-wide catalog data the reviewer needs to choose from — org_id filters
  // added explicitly here (previously absent — a cross-org leak in this
  // dropdown; harmless for ticket *creation* itself since createRequestCore()
  // independently re-validates org_id, but still worth not showing).
  // form_fields/form_sections/template are pulled alongside name/team_id so
  // the Review UI can resolve the exact same requester form
  // (resolveServiceFormSections()) and run the exact same entity autofill
  // (lib/intake/autofill.ts) and mandatory-field gate
  // (validateRequesterFormCompletion()) the server will — reactively,
  // client-side, without a config format of its own.
  const [{ review, attachments, thread }, { data: services }, { data: teams }] = await Promise.all([
    getIntakeReview(id),
    admin
      .from('services')
      .select('id, name, team_id, form_fields, form_sections, template:form_templates(form_sections)')
      .eq('org_id', profile.org_id ?? '')
      .eq('is_active', true)
      .order('name'),
    admin.from('teams').select('id, name').eq('org_id', profile.org_id ?? '').eq('is_active', true).order('name'),
  ])

  if (!review) notFound()

  const serviceIds = (services ?? []).map((s) => s.id)

  // Every active, org-visible Sub-Category tagged to any of these services,
  // grouped by service_id — service_sub_category_tags has no org_id column
  // of its own (junction table; see the migration's own comment), but each
  // service_id here has already been org-scoped above, and a Sub-Category
  // can only ever be tagged to exactly ONE service
  // (service_sub_category_tags_sub_category_id_key), so this can never
  // surface another org's Sub-Category.
  const { data: subCategoryTags } = serviceIds.length
    ? await admin
        .from('service_sub_category_tags')
        .select('service_id, sub_category:service_sub_categories(id, name, is_active)')
        .in('service_id', serviceIds)
    : { data: [] as { service_id: string; sub_category: { id: string; name: string; is_active: boolean } | null }[] }

  const subCategoriesByService: Record<string, { id: string; name: string }[]> = {}
  for (const row of subCategoryTags ?? []) {
    const sub = row.sub_category as { id: string; name: string; is_active: boolean } | null
    if (!sub || !sub.is_active) continue
    ;(subCategoriesByService[row.service_id] ??= []).push({ id: sub.id, name: sub.name })
  }

  // The classifier's extracted entities for this message (refs/amounts/
  // dates/emails) — the exact same input buildFormData() uses server-side in
  // approveAndCreate(); fetched once here so the client can preview the same
  // autofill for whichever service the reviewer selects, instead of
  // re-deriving a parallel guess at what the server will fill in.
  const { data: finalClassification } = await admin
    .from('intake_classifications')
    .select('entities')
    .eq('message_id', review.message_id)
    .eq('is_final', true)
    .maybeSingle()
  const entities = (finalClassification?.entities ?? {}) as {
    refs?: string[]; amounts?: string[]; dates?: string[]; emails?: string[]
  }

  // Tasks is Admin/Owner-only for now (see components/layout/Sidebar.tsx) —
  // INTAKE_ROLES includes plain agents/managers, but /tasks/[id] would
  // redirect them to /home, so ReviewClient needs to know not to link there.
  const isAdmin = profile.role === 'admin' || profile.role === 'platform_owner'

  // DESK-STORAGE-001: same-origin proxy path, not a real signed URL — see
  // app/api/storage/attachment/intake/[id]/route.ts (forces
  // Content-Disposition: attachment itself, and re-checks RLS on every
  // fetch instead of baking access into a signed URL rooted at
  // NEXT_PUBLIC_SUPABASE_URL, Main's LAN-only address).
  const signedAttachments = attachments.map((a) => ({
    ...a,
    signedUrl: `/api/storage/attachment/intake/${a.id}`,
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Review"
        description={review.message?.subject ?? '(no subject)'}
        breadcrumbs={[{ label: 'Intake', href: '/intake' }, { label: 'Inbox', href: '/intake/inbox' }, { label: 'Review' }]}
      />
      <ReviewClient
        review={review}
        attachments={signedAttachments}
        thread={thread}
        services={(services ?? []) as {
          id: string; name: string; team_id: string | null
          form_fields: unknown; form_sections: unknown
          template: { form_sections: unknown } | null
        }[]}
        teams={(teams ?? []) as { id: string; name: string }[]}
        subCategoriesByService={subCategoriesByService}
        entities={entities}
        profileId={profile.id}
        isAdmin={isAdmin}
      />
    </div>
  )
}
