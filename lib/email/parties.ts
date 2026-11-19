// "Who is who on this ticket" for every ticket e-mail: a small block with the Requester and the Technician, so that the requester always sees the technician, the technician always
// sees the requester, and everyone else on the ticket sees both. Also the role label ("Technician", "Requester", "Manager", "Other") shown next to the name of whoever did something
// (a comment, a status change, a resolution).
//
// Pure formatting plus one small loader; no mail is sent here. The block is added by the templates (templates.ts, csat-templates.ts, approval-reminder.ts).

import { escapeHtml } from './escape'

export const NOT_ASSIGNED = 'Not assigned yet'

export interface Parties {
  requesterName: string
  /** null / empty = nobody is assigned yet */
  technicianName: string | null
  /** the reader is the requester / the technician: "(you)" is added after their own name */
  requesterIsYou?: boolean
  technicianIsYou?: boolean
  /** extra lines under the two names, for example "Sent for approval by" */
  extra?: { label: string; value: string }[]
}

export type PartyRole = 'Requester' | 'Technician' | 'Manager' | 'Other'

const nameWithYou = (name: string, you?: boolean) => (you ? `${name} (you)` : name)

/** The two lines as plain text ("Requester: X"), or '' when nothing is known (a mail that does not belong to a ticket). */
export function partiesText(p?: Parties): string {
  if (!p || !p.requesterName.trim()) return ''
  const tech = p.technicianName?.trim()
  const lines = [`Requester: ${nameWithYou(p.requesterName.trim(), p.requesterIsYou)}`, `Technician: ${tech ? nameWithYou(tech, p.technicianIsYou) : NOT_ASSIGNED}`]
  for (const x of p.extra ?? []) if (x.value.trim()) lines.push(`${x.label}: ${x.value.trim()}`)
  return lines.join('\n')
}

/** The same two lines as a small grey box for the HTML mail. Names are escaped. */
export function partiesHtml(p?: Parties): string {
  if (!p || !p.requesterName.trim()) return ''
  const tech = p.technicianName?.trim()
  const row = (label: string, value: string, strong = true) =>
    `<tr><td style="padding:2px 14px 2px 0;color:#64748b;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:2px 0;color:#1f2937;${strong ? 'font-weight:600;' : 'color:#64748b;'}">${value}</td></tr>`
  const rows = [
    row('Requester', escapeHtml(nameWithYou(p.requesterName.trim(), p.requesterIsYou))),
    row('Technician', tech ? escapeHtml(nameWithYou(tech, p.technicianIsYou)) : escapeHtml(NOT_ASSIGNED), !!tech),
    ...(p.extra ?? []).filter((x) => x.value.trim()).map((x) => row(x.label, escapeHtml(x.value.trim()))),
  ].join('')
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:14px 0;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:8px 14px;font-size:14px;"><tbody>${rows}</tbody></table>`
}

/** "Amit Verma (Technician)" with the name escaped, or just the name when the role is not known. */
export function nameWithRoleHtml(name: string, role?: string | null): string {
  return role ? `${escapeHtml(name)} (${escapeHtml(role)})` : escapeHtml(name)
}
export function nameWithRoleText(name: string, role?: string | null): string {
  return role ? `${name} (${role})` : name
}

/**
 * What the person who did something was, in relation to this ticket: the requester, the technician (the assigned one, or any other technician), a manager / administrator, or
 * someone else (for example a store colleague who replied by e-mail). `userRole` is the profile role ('user', 'agent', 'manager', 'admin', 'platform_owner').
 */
export function roleOnTicket(p: { actorId?: string | null; requesterId?: string | null; assigneeId?: string | null; userRole?: string | null }): PartyRole | null {
  if (!p.actorId) return null
  if (p.requesterId && p.actorId === p.requesterId) return 'Requester'
  if (p.assigneeId && p.actorId === p.assigneeId) return 'Technician'
  if (p.userRole === 'manager' || p.userRole === 'admin' || p.userRole === 'platform_owner') return 'Manager'
  if (p.userRole === 'agent') return 'Technician'
  return 'Other'
}

// ── carried through the notification pipeline as plain strings (NotificationData is Record<string, string>) ──
export const PARTY_KEYS = {
  has: 'partyHas', requester: 'partyRequester', technician: 'partyTechnician', requesterIsYou: 'partyRequesterIsYou', technicianIsYou: 'partyTechnicianIsYou', actorRole: 'partyActorRole',
} as const

/** Reads the party fields out of a notification's data. undefined when the notification does not belong to a ticket. */
export function partiesFromData(data: Record<string, string | undefined>): Parties | undefined {
  if (data[PARTY_KEYS.has] !== '1') return undefined
  return {
    requesterName: data[PARTY_KEYS.requester] ?? '',
    technicianName: data[PARTY_KEYS.technician] || null,
    requesterIsYou: data[PARTY_KEYS.requesterIsYou] === '1',
    technicianIsYou: data[PARTY_KEYS.technicianIsYou] === '1',
  }
}

/** The fields to put into a notification's data for one reader. */
export function partyData(p: { requesterName: string; technicianName: string | null; requesterId?: string | null; technicianId?: string | null; readerId?: string | null; actorRole?: string | null }): Record<string, string> {
  return {
    [PARTY_KEYS.has]: '1',
    [PARTY_KEYS.requester]: p.requesterName,
    [PARTY_KEYS.technician]: p.technicianName ?? '',
    [PARTY_KEYS.requesterIsYou]: p.readerId && p.requesterId && p.readerId === p.requesterId ? '1' : '',
    [PARTY_KEYS.technicianIsYou]: p.readerId && p.technicianId && p.readerId === p.technicianId ? '1' : '',
    [PARTY_KEYS.actorRole]: p.actorRole ?? '',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

/** The requester and the assigned technician of one ticket, by name (null name = nobody assigned). Never throws: a failure just means no block in the mail. */
export async function loadTicketParties(admin: AnyClient, requestId: string): Promise<{ requesterId: string | null; requesterName: string; technicianId: string | null; technicianName: string | null } | null> {
  try {
    const { data } = await admin.from('requests')
      .select('requester_id, assigned_to, requester:profiles!requests_requester_id_fkey(full_name), assignee:profiles!requests_assigned_to_fkey(full_name)')
      .eq('id', requestId).maybeSingle()
    if (!data) return null
    const one = (v: unknown): { full_name?: string | null } | null => (Array.isArray(v) ? (v[0] ?? null) : ((v as { full_name?: string | null } | null) ?? null))
    return {
      requesterId: data.requester_id ?? null, requesterName: one(data.requester)?.full_name ?? '',
      technicianId: data.assigned_to ?? null, technicianName: one(data.assignee)?.full_name ?? null,
    }
  } catch {
    return null
  }
}
