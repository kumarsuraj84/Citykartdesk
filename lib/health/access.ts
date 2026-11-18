// Who may see Health & Performance: PLATFORM OWNERS ONLY. Not admins, not managers, not agents/technicians, not requesters.
// One rule, used by the menu entry, the page, the alert banner, the actions and the collector's read side, so they can never drift apart.
export function canSeeHealth(role: string | null | undefined): boolean {
  return role === 'platform_owner'
}
