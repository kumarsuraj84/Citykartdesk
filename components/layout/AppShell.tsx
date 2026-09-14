import { Suspense } from 'react'
import Link from 'next/link'
import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { NotificationBell } from './NotificationBell'
import { ApprovalsBell } from './ApprovalsBell'
import { GlobalSearch } from './GlobalSearch'
import { ThemeSwitcher } from './ThemeSwitcher'
import { BrandLogo } from './BrandLogo'
import { AutoRefresh } from './AutoRefresh'
import { AutoPushPrompt } from './AutoPushPrompt'
import { ROLE_LABELS } from '@/lib/constants/roles'
import type { ProfileWithTeams, NavVisibility, NotificationWithActor } from '@/types'
import type { NavCounts } from '@/lib/queries/profiles'

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
}

const ZERO_COUNTS: NavCounts = { requests: 0, tasks: 0, approvals: 0, notifications: 0, projects: 0 }

interface AppShellProps {
  profile: ProfileWithTeams
  navVisibility: NavVisibility
  navCountsPromise: Promise<NavCounts>
  notificationsPromise: Promise<NotificationWithActor[]>
  children: React.ReactNode
}

async function DeferredSidebar({
  promise,
  profile,
  navVisibility,
}: {
  promise: Promise<NavCounts>
  profile: ProfileWithTeams
  navVisibility: NavVisibility
}) {
  const navCounts = await promise
  return <Sidebar profile={profile} navVisibility={navVisibility} navCounts={navCounts} className="hidden lg:flex" />
}

async function DeferredMobileNav({
  promise,
  profile,
  navVisibility,
}: {
  promise: Promise<NavCounts>
  profile: ProfileWithTeams
  navVisibility: NavVisibility
}) {
  const navCounts = await promise
  return <MobileNav profile={profile} navVisibility={navVisibility} navCounts={navCounts} />
}

async function DeferredNotificationBell({
  navCountsPromise,
  notificationsPromise,
  viewerId,
  viewerRole,
}: {
  navCountsPromise: Promise<NavCounts>
  notificationsPromise: Promise<NotificationWithActor[]>
  viewerId: string
  viewerRole: ProfileWithTeams['role']
}) {
  const [navCounts, notifications] = await Promise.all([navCountsPromise, notificationsPromise])
  // Approval-required items live in their own bell (see DeferredApprovalsBell)
  // — kept out of the general feed so an actionable item never gets buried
  // among comments/assignments/SLA warnings.
  const generalNotifications = notifications.filter((n) => n.type !== 'approval_requested')
  const approvalUnreadCount = notifications.filter((n) => n.type === 'approval_requested' && !n.read_at).length
  return (
    <NotificationBell
      initialNotifications={generalNotifications}
      initialUnreadCount={Math.max(0, navCounts.notifications - approvalUnreadCount)}
      viewerId={viewerId}
      viewerRole={viewerRole}
      dark
    />
  )
}

async function DeferredApprovalsBell({
  navCountsPromise,
  notificationsPromise,
  viewerId,
  viewerRole,
}: {
  navCountsPromise: Promise<NavCounts>
  notificationsPromise: Promise<NotificationWithActor[]>
  viewerId: string
  viewerRole: ProfileWithTeams['role']
}) {
  const [navCounts, notifications] = await Promise.all([navCountsPromise, notificationsPromise])
  const approvalNotifications = notifications.filter((n) => n.type === 'approval_requested')
  return (
    <ApprovalsBell
      initialNotifications={approvalNotifications}
      initialCount={navCounts.approvals}
      viewerId={viewerId}
      viewerRole={viewerRole}
      dark
    />
  )
}

export function AppShell({ profile, navVisibility, navCountsPromise, notificationsPromise, children }: AppShellProps) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <AutoRefresh />
      <AutoPushPrompt />

      {/* ── Dark top bar (full width) ─────────────────────────────────────── */}
      <header className="flex h-16 shrink-0 items-center gap-4 px-4 border-b border-black/10 bg-[image:var(--gradient-nav)] z-40">

        {/* Brand — matches sidebar width */}
        <Link href="/home" className="flex w-[196px] shrink-0 items-center">
          <BrandLogo height={44} className="rounded-lg bg-white px-2.5 py-1.5 shadow-sm" priority />
        </Link>

        {/* Search — centred in remaining space */}
        <div className="flex-1 max-w-xl">
          <GlobalSearch dark />
        </div>

        {/* Right: notifications + user */}
        <div className="ml-auto flex items-center gap-1">
          <ThemeSwitcher />
          <Suspense fallback={<div className="w-9 h-9" />}>
            <DeferredApprovalsBell
              navCountsPromise={navCountsPromise}
              notificationsPromise={notificationsPromise}
              viewerId={profile.id}
              viewerRole={profile.role}
            />
          </Suspense>
          <Suspense fallback={<div className="w-9 h-9" />}>
            <DeferredNotificationBell
              navCountsPromise={navCountsPromise}
              notificationsPromise={notificationsPromise}
              viewerId={profile.id}
              viewerRole={profile.role}
            />
          </Suspense>
          <div className="h-5 w-px bg-white/15 mx-1" />
          <Link href="/profile" className="flex items-center gap-2 pl-1 pr-2 h-9 rounded-lg hover:bg-white/10 transition-colors">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-glow to-primary grid place-items-center text-primary-foreground text-[11px] font-bold shadow-sm shrink-0">
              {getInitials(profile.full_name)}
            </div>
            <div className="hidden xl:block text-left leading-tight">
              <p className="text-[12px] font-semibold text-white">{profile.full_name}</p>
              <p className="text-[10px] text-white/60">{ROLE_LABELS[profile.role]}</p>
            </div>
          </Link>
        </div>
      </header>

      {/* ── Body: sidebar + content ───────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <Suspense fallback={<Sidebar profile={profile} navVisibility={navVisibility} navCounts={ZERO_COUNTS} className="hidden lg:flex" />}>
          <DeferredSidebar promise={navCountsPromise} profile={profile} navVisibility={navVisibility} />
        </Suspense>

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="page">
            {children}
          </div>
        </main>
      </div>

      <Suspense fallback={<MobileNav profile={profile} navVisibility={navVisibility} navCounts={ZERO_COUNTS} />}>
        <DeferredMobileNav promise={navCountsPromise} profile={profile} navVisibility={navVisibility} />
      </Suspense>
    </div>
  )
}
