import Link from 'next/link'
import { canSeeHealth } from '@/lib/health/access'
import { labelOf } from '@/lib/health/catalog'
import { getOpenIncidents } from '@/lib/health/queries'

/**
 * Red bar on top of a PLATFORM OWNER's screens while something is in an open outage (portal only: no e-mail or message is sent).
 * Draws nothing for anybody else, and nothing at all when everything is fine. Never throws (the bar must not break a page).
 */
export async function HealthBanner({ role }: { role: string | null | undefined }) {
  if (!canSeeHealth(role)) return null
  const open = await getOpenIncidents()
  if (open.length === 0) return null
  const names = open.map((o) => labelOf(o.checkKey))
  return (
    <div role="alert" className="flex shrink-0 flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-red-600 px-4 py-1.5 text-center text-xs font-semibold text-white">
      <span>Health alert: {names.slice(0, 3).join(', ')}{names.length > 3 ? ` and ${names.length - 3} more` : ''} {names.length === 1 ? 'needs' : 'need'} attention.</span>
      <Link href="/health" prefetch={false} className="underline underline-offset-2">Open Health & Performance</Link>
    </div>
  )
}
