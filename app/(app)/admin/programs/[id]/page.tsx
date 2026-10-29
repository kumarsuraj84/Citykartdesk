import { notFound, redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { PageHeader } from '@/components/ui/PageHeader'
import { loadProgramEditor } from '@/lib/programs/admin-data'
import { programTemplate } from '@/lib/programs/mail'
import { ProgramEditorClient } from './ProgramEditorClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vendor Program' }

export default async function VendorProgramPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'platform_owner'].includes(profile.role)) redirect('/home')
  if (!profile.org_id) redirect('/home')
  const { id } = await params
  const data = await loadProgramEditor(profile.org_id, id)
  if (!data) notFound()
  const tpl = programTemplate(data.program)
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title={data.program.name}
        description="Set the program up from top to bottom. It can be switched on when everything in the check list is green."
        breadcrumbs={[{ label: 'Vendor Programs', href: '/admin/programs' }, { label: data.program.name }]}
      />
      <ProgramEditorClient
        key={`${data.program.id}:${data.program.last_checked_at ?? ''}:${data.program.is_active}`}
        data={data}
        subject={tpl.subject}
        body={tpl.body}
        customTemplate={!!(data.program.mail_subject || data.program.mail_body_html)}
      />
    </div>
  )
}
