import { notFound, redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getInboxMessage } from '@/lib/queries/intake'
import { createAdminClient } from '@/lib/supabase/admin'
import { WorkspaceClient } from './WorkspaceClient'

const INTAKE_ROLES = ['agent', 'manager', 'admin', 'platform_owner']

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function InboxWorkspacePage({ params }: PageProps) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!INTAKE_ROLES.includes(profile.role)) redirect('/home')

  const { id } = await params
  const admin = createAdminClient()

  const [{ message, attachments, thread }, { data: services }, { data: teams }] = await Promise.all([
    getInboxMessage(id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as unknown as { from: (t: string) => any }).from('services').select('id, name, team_id').eq('is_active', true).order('name'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as unknown as { from: (t: string) => any }).from('teams').select('id, name').eq('is_active', true).order('name'),
  ])

  if (!message) notFound()

  // Tasks is Admin/Owner-only for now (see components/layout/Sidebar.tsx) —
  // INTAKE_ROLES includes plain agents/managers, but /tasks/[id] would
  // redirect them to /home, so WorkspaceClient needs to know not to link there.
  const isAdmin = profile.role === 'admin' || profile.role === 'platform_owner'

  // The Review screen is the full detail (email + reply + classify + Approve/
  // Reject + convert). Whenever this message already has a review, send the user
  // there so the categorisation form is always present. The Workspace below is
  // only the fallback for not-yet-classified mail.
  if (message.review?.id) redirect(`/intake/review/${message.review.id}`)

  // Generate signed URLs for attachments.
  const signedAttachments = await Promise.all(
    attachments.map(async (a) => {
      const { data } = await admin.storage.from('intake-attachments').createSignedUrl(a.storage_path, 300)
      return { ...a, signedUrl: data?.signedUrl ?? null }
    })
  )

  return (
    <WorkspaceClient
      message={message}
      attachments={signedAttachments}
      thread={thread}
      services={(services ?? []) as { id: string; name: string; team_id: string | null }[]}
      teams={(teams ?? []) as { id: string; name: string }[]}
      profileId={profile.id}
      isAdmin={isAdmin}
    />
  )
}
