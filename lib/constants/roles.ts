import type { UserRole } from '@/types'

// ── Role ─────────────────────────────────────────────────────────────────────
// Single source of truth for how a role is SHOWN to people — the underlying
// enum values ('user', 'agent', ...) are unchanged everywhere else (RLS,
// role === 'agent' checks, etc.); this only controls display text/color so
// every screen reads the same nomenclature: a 'user' raises tickets (shown as
// "Requester"), an 'agent' resolves them (shown as "Technician").

export const ROLE_LABELS: Record<UserRole, string> = {
  user:            'Requester',
  agent:           'Technician',
  manager:         'Manager',
  admin:           'Admin',
  platform_owner:  'Platform Owner',
}

export const ROLE_BADGE_STYLES: Record<UserRole, string> = {
  platform_owner: 'text-purple-700 bg-purple-50 border-purple-300 font-bold',
  admin:          'text-red-700 bg-red-50 border-red-200',
  manager:        'text-orange-700 bg-orange-50 border-orange-200',
  agent:          'text-blue-700 bg-blue-50 border-blue-200',
  user:           'text-slate-600 bg-slate-50 border-slate-200',
}
