import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { redirect } from 'next/navigation'
import { getApprovalWorkflows } from '@/lib/queries/admin'
import { WorkflowBuilderClient } from './WorkflowBuilderClient'

export const metadata = { title: 'Approval Flows — Admin' }

export default async function ApprovalFlowsPage() {
  const profile = await getCurrentProfile()
  if (!profile || (profile.role !== 'admin' && profile.role !== 'manager' && profile.role !== 'platform_owner')) {
    redirect('/home')
  }

  const admin = createAdminClient()
  const orgId = profile.org_id ?? ''

  const [workflows, { data: services }, { data: approvers }] = await Promise.all([
    getApprovalWorkflows(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any)
      .from('services')
      .select('id, name, slug, approval_workflow_id, is_active')
      .eq('org_id', orgId)
      .order('name', { ascending: true }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any)
      .from('profiles')
      .select('id, full_name, role')
      .eq('org_id', orgId)
      .in('role', ['admin', 'manager'])
      .eq('is_active', true)
      .order('full_name', { ascending: true }),
  ])

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Approval Flows</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Build multi-step approval workflows and bind them to services.
        </p>
      </div>

      <WorkflowBuilderClient
        initialWorkflows={workflows}
        services={(services ?? []) as { id: string; name: string; slug: string; approval_workflow_id: string | null; is_active: boolean }[]}
        approvers={(approvers ?? []) as { id: string; full_name: string; role: string }[]}
      />
    </div>
  )
}
