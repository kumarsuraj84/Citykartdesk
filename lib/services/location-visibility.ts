// Who may see (and raise tickets in) a service, by the Location boxes ticked on it in Admin > Services. One rule for the catalog, the service page, the ticket-creation check and
// the WhatsApp / mail service list, so they can never disagree:
//   - Head Office ticked      -> only people whose Location is Head Office;
//   - Stores ticked           -> only people whose Location is Stores;
//   - both ticked             -> both;
//   - nothing ticked          -> only administrators and platform owners see it;
//   - a person with no Location sees no service until an administrator gives them one.
// The rule is the same for requesters, technicians, vendor technicians and managers while they LOG a ticket: a technician or manager does not need the catalog to work a ticket,
// because tickets reach them through Business Rules and they open and work them from the ticket itself. Only administrators and platform owners see every service.

/** True when a person at `userLocationId` may see a service ticked for `tagLocationIds`. */
export function isServiceVisibleToLocation(tagLocationIds: readonly string[], userLocationId: string | null | undefined): boolean {
  return !!userLocationId && tagLocationIds.includes(userLocationId)
}

/** The location rule above is skipped only for administrators and platform owners. */
export function isLocationRuleExempt(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'platform_owner'
}
