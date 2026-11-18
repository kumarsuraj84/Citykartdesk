import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { canSeeHealth } from '@/lib/health/access'

/**
 * Health & Performance. PLATFORM OWNERS ONLY (the owner's decision): administrators, managers, technicians and requesters are sent home, and the menu
 * entry and the alert bar are not even drawn for them (same rule, lib/health/access.ts).
 */
export default async function HealthLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!canSeeHealth(profile.role)) redirect('/home')
  return <div className="mx-auto max-w-7xl space-y-4">{children}</div>
}
