import { redirect } from 'next/navigation'
import { User, Shield, Users, Building2, Lock, BellRing } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile, getDirectReports } from '@/lib/queries/profiles'
import { EditableName, AvatarUpload, PasswordResetButton, ChangePasswordForm, PushNotificationToggle, PopupSettings } from './ProfileClient'
import { hasPushSubscription } from '@/lib/actions/push'
import { ROLE_LABELS } from '@/lib/constants/roles'
import type { UserRole } from '@/types'

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  )
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export default async function ProfilePage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  const supabase = await createClient()
  const [{ data: { user } }, pushOn, managerRow, team] = await Promise.all([
    supabase.auth.getUser(),
    hasPushSubscription(),
    // who I report to (the Manager box on my account), and the people who report to me
    profile.manager_id ? supabase.from('profiles').select('id, full_name, role').eq('id', profile.manager_id).maybeSingle() : Promise.resolve({ data: null }),
    getDirectReports(profile.id),
  ])
  const manager = managerRow.data as { id: string; full_name: string; role: UserRole } | null

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground">My Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your account information</p>
      </div>

      {/* Avatar + name card */}
      <div className="flex items-center gap-5 rounded-2xl border border-border bg-card px-6 py-5 shadow-sm">
        <AvatarUpload
          initials={getInitials(profile.full_name)}
          currentUrl={(profile as { avatar_url?: string | null }).avatar_url}
        />
        <div>
          <p className="text-xl font-semibold text-foreground">{profile.full_name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground capitalize">
            {ROLE_LABELS[profile.role] ?? profile.role}
          </p>
        </div>
      </div>

      {/* Account details */}
      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <User className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Account Details</h2>
        </div>
        <div className="divide-y divide-border px-5">
          <InfoRow label="Full name" value={<EditableName initialName={profile.full_name} />} />
          <InfoRow label="Email" value={user?.email ?? '—'} />
          <InfoRow label="Reports to" value={manager ? <span>{manager.full_name} <span className="text-xs font-normal text-muted-foreground">({ROLE_LABELS[manager.role] ?? manager.role})</span></span> : '—'} />

          <InfoRow
            label="Member since"
            value={new Date(profile.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          />
          <InfoRow
            label="Role"
            value={
              <span className="inline-flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                {ROLE_LABELS[profile.role] ?? profile.role}
              </span>
            }
          />
          <InfoRow
            label="Status"
            value={
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                  profile.is_active
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {profile.is_active ? 'Active' : 'Inactive'}
              </span>
            }
          />
        </div>
      </div>

      {/* Security */}
      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Security</h2>
        </div>
        <div className="divide-y divide-border px-5">
          <InfoRow label="Password" value={<ChangePasswordForm />} />
          <InfoRow label="Forgot it?" value={<PasswordResetButton />} />
        </div>
      </div>

      {/* Notifications */}
      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
          <BellRing className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
        </div>
        <div className="divide-y divide-border px-5">
          <InfoRow label="Pop-ups in CK Desk (this browser)" value={<PopupSettings />} />
          <InfoRow label="Push notifications on this device" value={<PushNotificationToggle initiallyOn={pushOn} />} />
        </div>
      </div>

      {/* My team: the people who report to me */}
      {team.length > 0 && (
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">My Team</h2>
            <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{team.length}</span>
          </div>
          <ul className="divide-y divide-border px-5" aria-label="People who report to you">
            {team.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-3">
                <span className="text-sm font-medium text-foreground">{m.full_name}</span>
                <span className="text-xs text-muted-foreground">{ROLE_LABELS[m.role] ?? m.role}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Teams */}
      {profile.team_members.length > 0 && (
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border px-5 py-3.5">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">Technician Groups</h2>
          </div>
          <div className="divide-y divide-border px-5">
            {profile.team_members.map((tm) => (
              <div key={tm.team_id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-sm font-medium text-foreground">{tm.team.name}</span>
                </div>
                {tm.is_lead && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    Technician Group Lead
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
