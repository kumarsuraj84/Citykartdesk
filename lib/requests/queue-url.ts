// The address of the technicians' Agent Requests page (/requests/queue): which tab (assigned to me, or the team queue) and which filters are chosen.
// Every filter, sort and search keeps the tab you are on; without it a filter chosen on the Team Queue dropped the page back to "My Requests".

export interface QueueUrlState {
  layout: 'table' | 'board'
  tab: 'mine' | 'team'
  status?: string
  q?: string
  requester?: string
  /** the technician chosen in the team queue */
  assigned?: string
  breachedOnly?: boolean
  priority?: string
  service?: string
  category?: string
  subcategory?: string
  sort?: string
  dir?: string
}

/** The page's choices as address parameters, for the links and filters that change one thing and keep the rest. */
export function queueParams(s: QueueUrlState): URLSearchParams {
  const p = new URLSearchParams()
  if (s.layout !== 'table') p.set('layout', s.layout)
  if (s.tab === 'team') p.set('tab', 'team')
  if (s.status && s.status !== 'active') p.set('status', s.status)
  if (s.q) p.set('q', s.q)
  if (s.requester) p.set('requester', s.requester)
  if (s.tab === 'team' && s.assigned) p.set('assigned', s.assigned)
  if (s.breachedOnly) p.set('sla', 'breached')
  if (s.priority) p.set('priority', s.priority)
  if (s.service) p.set('service', s.service)
  if (s.category) p.set('category', s.category)
  if (s.subcategory) p.set('subcategory', s.subcategory)
  if (s.sort) p.set('sort', s.sort)
  if (s.dir) p.set('dir', s.dir)
  return p
}

/** Moving to the other tab: each tab keeps its own filters, so the choices made on one tab do not follow you to the other. */
export function queueTabParams(tab: 'mine' | 'team', layout: 'table' | 'board'): URLSearchParams {
  const p = new URLSearchParams()
  if (layout !== 'table') p.set('layout', layout)
  p.set('tab', tab)
  return p
}
