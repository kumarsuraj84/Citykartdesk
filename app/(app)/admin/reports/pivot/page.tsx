import { redirect } from 'next/navigation'

// Moved to app/(app)/reports/pivot (see that file for why — Product Decision
// A / DESK-QA-001). This stub only exists so an admin/manager/platform_owner
// with the old URL bookmarked lands somewhere useful; note this path is still
// covered by app/(app)/admin/layout.tsx's admin-tier gate, so it never
// becomes a new way for a broader role to reach the page — they were already
// redirected to the new /reports/pivot from the sidebar.
export default function LegacyReportBuilderRedirect() {
  redirect('/reports/pivot')
}
