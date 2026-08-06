import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { PageHeader } from '@/components/ui/PageHeader'
import { PermissionMatrixClient } from './PermissionMatrixClient'
import { Check, Minus } from 'lucide-react'

type Tab = 'overview' | 'users' | 'permissions'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',    label: 'Role Overview'     },
  { id: 'users',       label: 'User → Role'       },
  { id: 'permissions', label: 'Permission Matrix'  },
]

// ── Role definitions ──────────────────────────────────────────────────────────

const ROLE_META: Record<string, { label: string; color: string; description: string; badge: string }> = {
  user: {
    label:       'End User',
    color:       'bg-slate-100 text-slate-700 border-slate-200',
    badge:       'bg-slate-50 text-slate-600 border border-slate-200',
    description: 'Can submit requests via the service catalog, track their own requests, and respond to CSAT surveys. No access to agent queues or admin areas.',
  },
  agent: {
    label:       'Agent',
    color:       'bg-blue-100 text-blue-700 border-blue-200',
    badge:       'bg-blue-50 text-blue-600 border border-blue-200',
    description: 'Handles requests assigned to their team. Can update status, add comments (including internal notes), manage tasks, and trigger SLA actions.',
  },
  manager: {
    label:       'Manager',
    color:       'bg-violet-100 text-violet-700 border-violet-200',
    badge:       'bg-violet-50 text-violet-600 border border-violet-200',
    description: 'All agent capabilities plus approval authority, full request visibility across their teams, analytics access, and limited admin configuration.',
  },
  admin: {
    label:       'Administrator',
    color:       'bg-amber-100 text-amber-700 border-amber-200',
    badge:       'bg-amber-50 text-amber-600 border border-amber-200',
    description: 'Full access to all configuration — service catalog, SLA policies, routing rules, user management, platform settings, and monitoring.',
  },
  platform_owner: {
    label:       'Platform Owner',
    color:       'bg-red-100 text-red-700 border-red-200',
    badge:       'bg-red-50 text-red-600 border border-red-200',
    description: 'Super-admin with unrestricted access to every page, action, and configuration in the platform including owner-only portal features.',
  },
}

// ── Permission matrix data ────────────────────────────────────────────────────

type Perm = boolean | 'partial'

type PermRow = {
  group:   string
  label:   string
  note?:   string
  user:    Perm
  agent:   Perm
  manager: Perm
  admin:   Perm
  owner:   Perm
}

const PERMISSION_MATRIX: PermRow[] = [
  // ── Workspace
  { group: 'Workspace',      label: 'View Home Dashboard',            user: true,      agent: true,      manager: true,    admin: true,    owner: true  },
  { group: 'Workspace',      label: 'Submit a Request',               user: true,      agent: true,      manager: true,    admin: true,    owner: true  },
  { group: 'Workspace',      label: 'View Own Requests',              user: true,      agent: true,      manager: true,    admin: true,    owner: true  },
  { group: 'Workspace',      label: 'View All Team Requests',         user: false,     agent: true,      manager: true,    admin: true,    owner: true  },
  { group: 'Workspace',      label: 'Assign Requests',                user: false,     agent: 'partial', manager: true,    admin: true,    owner: true,   note: 'Agents can self-assign within their team' },
  { group: 'Workspace',      label: 'Change Request Status',          user: 'partial', agent: true,      manager: true,    admin: true,    owner: true,   note: 'Users can only reopen or close resolved requests' },
  { group: 'Workspace',      label: 'Add Public Comments',            user: true,      agent: true,      manager: true,    admin: true,    owner: true  },
  { group: 'Workspace',      label: 'Add Internal Notes',             user: false,     agent: true,      manager: true,    admin: true,    owner: true  },
  { group: 'Workspace',      label: 'View Internal Notes',            user: false,     agent: true,      manager: true,    admin: true,    owner: true  },
  { group: 'Workspace',      label: 'Upload Attachments',             user: true,      agent: true,      manager: true,    admin: true,    owner: true  },
  { group: 'Workspace',      label: 'Set Priority',                   user: false,     agent: true,      manager: true,    admin: true,    owner: true  },
  { group: 'Workspace',      label: 'Manage Collaborators',           user: false,     agent: true,      manager: true,    admin: true,    owner: true  },
  // ── Tasks
  { group: 'Tasks',          label: 'View Tasks',                     user: false,     agent: true,      manager: true,    admin: true,    owner: true  },
  { group: 'Tasks',          label: 'Create Tasks',                   user: false,     agent: true,      manager: true,    admin: true,    owner: true  },
  { group: 'Tasks',          label: 'Complete / Close Tasks',         user: false,     agent: true,      manager: true,    admin: true,    owner: true  },
  // ── Approvals
  { group: 'Approvals',      label: 'View Approval Queue',            user: false,     agent: false,     manager: true,    admin: true,    owner: true  },
  { group: 'Approvals',      label: 'Approve / Reject Requests',      user: false,     agent: false,     manager: true,    admin: true,    owner: true  },
  { group: 'Approvals',      label: 'Delegate Approval',              user: false,     agent: false,     manager: true,    admin: true,    owner: true  },
  // ── Analytics
  { group: 'Analytics',      label: 'View Dashboards & Reports',      user: false,     agent: false,     manager: true,    admin: true,    owner: true  },
  { group: 'Analytics',      label: 'Export Data (CSV)',               user: false,     agent: false,     manager: true,    admin: true,    owner: true  },
  { group: 'Analytics',      label: 'Schedule Reports',                user: false,     agent: false,     manager: true,    admin: true,    owner: true  },
  { group: 'Analytics',      label: 'View Audit Logs',                 user: false,     agent: false,     manager: true,    admin: true,    owner: true  },
  // ── Administration
  { group: 'Administration', label: 'Manage Users & Roles',           user: false,     agent: false,     manager: false,   admin: true,    owner: true  },
  { group: 'Administration', label: 'Manage Teams',                   user: false,     agent: false,     manager: 'partial', admin: true,  owner: true,   note: 'Managers can view teams but not create/delete' },
  { group: 'Administration', label: 'Configure Service Catalog',      user: false,     agent: false,     manager: false,   admin: true,    owner: true  },
  { group: 'Administration', label: 'Configure Routing Rules',        user: false,     agent: false,     manager: false,   admin: true,    owner: true  },
  { group: 'Administration', label: 'Configure Approval Workflows',   user: false,     agent: false,     manager: false,   admin: true,    owner: true  },
  { group: 'Administration', label: 'Configure SLA Policies',         user: false,     agent: false,     manager: false,   admin: true,    owner: true  },
  { group: 'Administration', label: 'Configure Business Hours',       user: false,     agent: false,     manager: false,   admin: true,    owner: true  },
  { group: 'Administration', label: 'Configure Alert / Escalation',   user: false,     agent: false,     manager: false,   admin: true,    owner: true  },
  { group: 'Administration', label: 'Manage Departments & Locations', user: false,     agent: false,     manager: false,   admin: true,    owner: true  },
  { group: 'Administration', label: 'Platform Settings',              user: false,     agent: false,     manager: false,   admin: true,    owner: true  },
  { group: 'Administration', label: 'Master Data (Tags, Priorities)', user: false,     agent: false,     manager: false,   admin: true,    owner: true  },
  { group: 'Administration', label: 'Knowledge Base Management',      user: false,     agent: false,     manager: false,   admin: true,    owner: true  },
  // ── Queue
  { group: 'Queue',          label: 'System Monitoring',              user: false,     agent: false,     manager: false,   admin: true,    owner: true  },
  { group: 'Queue',          label: 'View Runbooks / Jobs',           user: false,     agent: false,     manager: false,   admin: true,    owner: true  },
]

const ROLES = ['user', 'agent', 'manager', 'admin', 'platform_owner'] as const

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) redirect('/home')

  const sp  = await searchParams
  const tab = (TABS.find(t => t.id === sp.tab) ? sp.tab : 'overview') as Tab

  const supabase = await createClient()

  // Always fetch user counts and profiles for overview + users tabs
  // Scope to the caller's org explicitly (defense-in-depth alongside RLS).
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active, org_id, created_at')
    .eq('org_id', profile.org_id ?? '')
    .order('role')
    .order('full_name')

  const roleCounts: Record<string, number> = {}
  for (const p of profiles ?? []) {
    roleCounts[p.role] = (roleCounts[p.role] ?? 0) + 1
  }

  // Get emails via admin client
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const emailMap = new Map<string, string>()
  for (const u of authData?.users ?? []) {
    if (u.email) emailMap.set(u.id, u.email)
  }

  // Permissions tab — fetch overrides + custom roles
  const [{ data: overrideRows }, { data: customRoleRows }] = tab === 'permissions'
    ? await Promise.all([
        supabase.from('permission_overrides').select('role_key, action_key, allowed'),
        supabase.from('custom_roles').select('id, name, description, base_role').eq('is_active', true).order('created_at'),
      ])
    : [{ data: null }, { data: null }]

  // Shape overrides into role_key → action_key → boolean map
  const overrides: Record<string, Record<string, boolean>> = {}
  for (const row of overrideRows ?? []) {
    if (!overrides[row.role_key]) overrides[row.role_key] = {}
    overrides[row.role_key][row.action_key] = row.allowed
  }

  const canEdit = ['admin', 'platform_owner'].includes(profile.role)

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        title="Roles & Permissions"
        description="Understand role capabilities, manage user assignments, and configure the permission matrix."
      />

      {/* ── Tab bar ── */}
      <div className="flex border-b border-border gap-1">
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <Link
              key={t.id}
              href={`?tab=${t.id}`}
              className={`px-3 py-1.5 text-[11px] font-medium border-b-2 transition-colors -mb-px ${
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </div>

      {/* ── Role Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            CognixDesk uses 5 hierarchical roles. Each role inherits the capabilities of roles below it.
          </p>
          <div className="space-y-3">
            {ROLES.map((role) => {
              const meta  = ROLE_META[role]
              const count = roleCounts[role] ?? 0
              return (
                <div key={role} className="rounded-xl border border-border bg-card p-4 flex items-start gap-4">
                  <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.color}`}>
                    {meta.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground leading-relaxed">{meta.description}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-bold text-foreground">{count}</p>
                    <p className="text-[10px] text-muted-foreground">user{count !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 flex items-center gap-6">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Legend</p>
            <div className="flex items-center gap-1.5 text-[11px] text-foreground"><Check className="h-3.5 w-3.5 text-emerald-600" /> Full access</div>
            <div className="flex items-center gap-1.5 text-[11px] text-foreground"><div className="h-2 w-2 rounded-sm bg-amber-400" /> Partial access (see matrix)</div>
            <div className="flex items-center gap-1.5 text-[11px] text-foreground"><Minus className="h-3 w-3 text-muted-foreground/30" /> No access</div>
          </div>
        </div>
      )}

      {/* ── User → Role ── */}
      {tab === 'users' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{(profiles ?? []).length} users across all roles</p>
            <Link href="/admin/users" className="btn-glossy-light btn-glossy-light-hover">
              Manage Users
            </Link>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="grid grid-cols-[1fr_160px_120px_80px] border-b border-border bg-muted/30 px-4 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">User</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Email</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Role</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
            </div>
            {(profiles ?? []).map((p) => {
              const meta = ROLE_META[p.role]
              return (
                <div key={p.id} className="grid grid-cols-[1fr_160px_120px_80px] items-center border-b border-border/50 last:border-0 px-4 py-2.5">
                  <span className="text-sm font-medium text-foreground truncate">{p.full_name}</span>
                  <span className="text-xs text-muted-foreground truncate">{emailMap.get(p.id) ?? '—'}</span>
                  <span>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta?.badge ?? ''}`}>
                      {meta?.label ?? p.role}
                    </span>
                  </span>
                  <span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      p.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-muted text-muted-foreground border border-border'
                    }`}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            To change a user&apos;s role, go to{' '}
            <Link href="/admin/users" className="text-primary hover:underline">User Management</Link>.
          </p>
        </div>
      )}

      {/* ── Permission Matrix ── */}
      {tab === 'permissions' && (
        <PermissionMatrixClient
          matrix={PERMISSION_MATRIX}
          systemRoles={[...ROLES]}
          customRoles={customRoleRows ?? []}
          overrides={overrides}
          canEdit={canEdit}
        />
      )}
    </div>
  )
}
