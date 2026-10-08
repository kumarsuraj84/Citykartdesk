// Who sees what on the Executive Dashboard. Everybody gets the same dashboard, narrowed to their level:
//   requester   → only the tickets they raised
//   technician  → the tickets of the technician groups they belong to (plus any they raised themselves)
//   manager     → the tickets of the groups they belong to
//   admin/owner → every ticket in the organisation

import { DIMS, type Dim } from './engine'

export type DashLevel = 'requester' | 'technician' | 'manager' | 'admin' | 'owner'

export function levelFor(role: string): DashLevel | null {
  switch (role) {
    case 'user': return 'requester'
    case 'agent': return 'technician'
    case 'manager': return 'manager'
    case 'admin': return 'admin'
    case 'platform_owner': return 'owner'
    default: return null
  }
}

export interface LevelCopy {
  title: string
  /** one line under the title describing whose tickets these are */
  scope: string
  /** what a ticket is called here */
  noun: string
  /** a requester has no use for staff-performance views */
  showPeople: boolean
  /** show the "only mine" shortcut (technicians) */
  showMine: boolean
}

export const LEVEL_COPY: Record<DashLevel, LevelCopy> = {
  requester:  { title: 'My Requests Dashboard', scope: 'Your requests', noun: 'requests', showPeople: false, showMine: false },
  technician: { title: 'Technician Dashboard', scope: 'Your technician groups', noun: 'tickets', showPeople: true, showMine: true },
  manager:    { title: 'Manager Dashboard', scope: 'Your technician groups', noun: 'tickets', showPeople: true, showMine: false },
  admin:      { title: 'Executive Dashboard', scope: 'All technician groups', noun: 'tickets', showPeople: true, showMine: false },
  owner:      { title: 'Executive Dashboard', scope: 'All technician groups', noun: 'tickets', showPeople: true, showMine: false },
}

/** What a viewer can slice by. A requester only has their own requests, so people-based slices are left out. */
export function dimsForLevel(level: DashLevel): Dim[] {
  return level === 'requester' ? ['cat', 'sub', 'svc', 'group', 'tech', 'prio', 'status'] : DIMS
}
