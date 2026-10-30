import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { isVendor, vendorMayOpen, vendorLandingFor } from '@/lib/vendor/access'
import { AppShell } from '@/components/layout/AppShell'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { getCurrentProfileForPasswordReset, getEnabledModules, getTrialInfo, getNavCounts, getDirectReportIds } from '@/lib/queries/profiles'
import { getNotifications } from '@/lib/queries/notifications'
import { getActionableApprovalsForUser } from '@/lib/queries/approvals'
import { TrialBanner } from '@/components/layout/TrialBanner'
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
    getCurrentProfileForPasswordReset(),
    getEnabledModules(),
    getTrialInfo(),
  ])

  if (!profile) {
    redirect('/login?retry=1')
  }

  // An OEM engineer (vendor login) sees only the vendor pages; a link to anything else (an e-mailed ticket link, a typed address) lands on his own page.
  if (isVendor(profile)) {
    const path = (await headers()).get('x-request-path') ?? ''
    if (path && !vendorMayOpen(path)) redirect(vendorLandingFor(path))
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
  // approval requests are kept out of this list: they are listed by the approvals bell from the approvals themselves
  const notificationsPromise = getNotifications(profile.id, { limit: 10, excludeTypes: ['approval_requested'] })
  const approvalItemsPromise = profile.org_id ? getActionableApprovalsForUser(profile.id, profile.role, profile.org_id) : Promise.resolve([])

  const isAgent =
    profile.role === 'agent' ||
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner'
  const isTeamLead = profile.team_members.some((m) => m.is_lead)
  const isManager = profile.role === 'manager' || profile.role === 'admin' || profile.role === 'platform_owner'
  const isAdmin = profile.role === 'admin' || profile.role === 'platform_owner'

  // a normal user who has people reporting to them gets the Dashboard for their team's tickets
  const hasTeam = profile.role === 'user' ? (await getDirectReportIds(profile.id)).length > 0 : false

  const navVisibility: NavVisibility = {
    isAgent,
    hasTeam,
    isTeamLead,
    isManager,
    isAdmin,
    hasPendingApprovals: isManager,
    enabledModules,
  }

  return (
    <>
      <EventTracker />
      {trialInfo?.isTrial && !trialInfo.isExpired && trialInfo.daysLeft <= 7 && (
        <TrialBanner daysLeft={trialInfo.daysLeft} />
      )}
      <AppShell
        profile={profile}
        navVisibility={navVisibility}
        navCountsPromise={navCountsPromise}
        notificationsPromise={notificationsPromise}
        approvalItemsPromise={approvalItemsPromise}
      >
        <ErrorBoundary>{children}</ErrorBoundary>
      </AppShell>
    </>
  )
}
