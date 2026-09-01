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

  const [{ review, attachments, thread }, { data: services }, { data: teams }] = await Promise.all([
    getIntakeReview(id),
    admin.from('services').select('id, name, team_id').eq('is_active', true).order('name'),
    admin.from('teams').select('id, name').eq('is_active', true).order('name'),
  ])

  if (!review) notFound()

  // Tasks is Admin/Owner-only for now (see components/layout/Sidebar.tsx) —
  // INTAKE_ROLES includes plain agents/managers, but /tasks/[id] would
  // redirect them to /home, so ReviewClient needs to know not to link there.
  const isAdmin = profile.role === 'admin' || profile.role === 'platform_owner'

  // Generate short-lived signed URLs for attachments (private bucket; admin client).
  const signedAttachments = await Promise.all(
    attachments.map(async (a) => {
      const { data } = await admin.storage.from('intake-attachments').createSignedUrl(a.storage_path, 300)
      return { ...a, signedUrl: data?.signedUrl ?? null }
    })
  )

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
        services={(services ?? []) as { id: string; name: string; team_id: string | null }[]}
        teams={(teams ?? []) as { id: string; name: string }[]}
        profileId={profile.id}
        isAdmin={isAdmin}
      />
    </div>
  )
}
