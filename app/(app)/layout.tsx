import { redirect } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { getCurrentProfile, getEnabledModules, getTrialInfo, getNavCounts } from '@/lib/queries/profiles'
import { getNotifications } from '@/lib/queries/notifications'
import { TrialBanner } from '@/components/layout/TrialBanner'
import { DemoBanner } from '@/components/layout/DemoBanner'
import { EventTracker } from '@/components/EventTracker'
import type { NavVisibility } from '@/types'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Run all three in parallel — getEnabledModules and getTrialInfo don't need
  // the profile result, so there's no reason to serialize them behind it.
  const [profile, enabledModules, trialInfo] = await Promise.all([
    getCurrentProfile(),
    getEnabledModules(),
    getTrialInfo(),
  ])

  if (!profile) {
    redirect('/login?retry=1')
  }

  if (trialInfo?.isExpired) {
    redirect('/trial-expired')
  }

  // Set by bulkCreateUsers/adminSetPassword — the user never chose this
  // password themselves, so they must set their own before touching anything
  // else. /reset-password lives outside this layout (app/(auth)) and doubles
  // as this flow: resetPassword() clears the flag on success.
  if (profile.must_reset_password) {
    redirect('/reset-password')
  }

  // Start these fetches immediately; they resolve while React streams the shell.
  const navCountsPromise = getNavCounts(profile.id)
  const notificationsPromise = getNotifications(profile.id, { limit: 10 })

  const isAgent =
    profile.role === 'agent' ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner'
  const isTeamLead = profile.team_members.some((m) => m.is_lead)
  const isManager = profile.role === 'manager' || profile.role === 'admin' || profile.role === 'platform_owner'
  const isAdmin = profile.role === 'admin' || profile.role === 'platform_owner'

  const navVisibility: NavVisibility = {
    isAgent,
    isTeamLead,
    isManager,
    isAdmin,
    hasPendingApprovals: isManager,
    enabledModules,
  }

  const isDemo = profile.id === 'ca8dbf6c-3a17-4ceb-81b5-2de57a6daa44'

  return (
    <>
      <EventTracker />
      {isDemo && <DemoBanner />}
      {trialInfo?.isTrial && !trialInfo.isExpired && trialInfo.daysLeft <= 7 && (
        <TrialBanner daysLeft={trialInfo.daysLeft} />
      )}
      <AppShell
        profile={profile}
        navVisibility={navVisibility}
        navCountsPromise={navCountsPromise}
        notificationsPromise={notificationsPromise}
      >
        <ErrorBoundary>{children}</ErrorBoundary>
      </AppShell>
    </>
  )
}
