import { notFound, redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { PageHeader } from '@/components/ui/PageHeader'
import { BUILT_IN, isBuiltInKind, loadBuiltInEditor } from '@/lib/programs/builtin'
import { BuiltInClient } from './BuiltInClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vendor Program' }

export default async function BuiltInProgramPage({ params }: { params: Promise<{ kind: string }> }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'platform_owner'].includes(profile.role)) redirect('/home')
  if (!profile.org_id) redirect('/home')
  const { kind } = await params
  if (!isBuiltInKind(kind)) notFound()
  const data = await loadBuiltInEditor(profile.org_id, kind)
  const spec = BUILT_IN[kind]
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title={`${spec.name} (built in)`}
        description={`The ${spec.name} line is set up here like every other vendor line. Its ticket form, OEM mail, vendor portal and approvals keep working exactly as before.`}
        breadcrumbs={[{ label: 'Vendor Programs', href: '/admin/programs' }, { label: spec.name }]}
      />
      <BuiltInClient
        key={`${kind}:${data.source?.last_checked_at ?? ''}:${data.categories.filter((c) => c.selected).length}`}
        data={data}
        spec={{ kind, title: spec.sheetTitle, hint: spec.hint }}
        rowType={spec.rowType}
      />
    </div>
  )
}
