import type { ProjectStatus } from '@/types'

/** The one canonical progress-percent rule for a project, shared by the
 *  project detail page (components/projects/ProjectHeader.tsx, and the
 *  Updates tab's currentProgressPct seed in app/(app)/projects/[id]/page.tsx)
 *  and the Projects analytics tab's owner/org "Avg Progress" figures
 *  (lib/queries/projectAnalytics.ts). Previously each of those three call
 *  sites independently derived a percentage as `done / total` linked
 *  tasks+requests, with no fallback for `total === 0` — so a project
 *  explicitly marked `done` (or `cancelled`) by its owner, but with no
 *  linked tasks/requests, reported a misleading 0% everywhere. A project's
 *  own status is a more authoritative completion signal than counting its
 *  (possibly empty) child items, so `done`/`cancelled` short-circuit to a
 *  fixed value; every other status keeps the original child-item ratio.
 *
 *  Deliberately dependency-free (no `@/lib/supabase/server`, no React) so it
 *  can be imported from client components (ProjectHeader is 'use client')
 *  without pulling server-only code into the client bundle. */
export function computeProjectProgressPct(
  status: ProjectStatus,
  progress: { done: number; total: number }
): number {
  if (status === 'done') return 100
  if (status === 'cancelled') return 0
  return progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
}
