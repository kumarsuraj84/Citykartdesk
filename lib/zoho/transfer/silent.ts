/**
 * Tickets moved in from Zoho (their number starts with ZOHO-) are SILENT until an administrator switches them on.
 *
 * Why: a ticket moved from Zoho keeps its Zoho created time, so an old open one is already late. The scheduled jobs (the "unassigned for N minutes" alerts and the
 * scheduled Business Rules such as "SLA 80% elapsed" or "overdue") would otherwise mail and notify managers and technicians about thousands of old tickets at the next run.
 * The move itself already sends nothing; this keeps the jobs from doing it later. The ticket is still visible, searchable, countable and workable like any other.
 *
 * The switch is one setting (app_settings key below). Default OFF = silent.
 */
export const ZOHO_NUMBER_LIKE = 'ZOHO-%'
export const MOVED_ACTIVE_SETTING = 'zoho.moved_tickets_active'

type AnyClient = { from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** true when moved tickets take part in alerts, reminders and scheduled rules. Any error reads as OFF (the safe side). */
export async function movedTicketsActive(admin: AnyClient): Promise<boolean> {
  try {
    const { data } = await admin.from('app_settings').select('value').eq('key', MOVED_ACTIVE_SETTING).maybeSingle()
    return String(data?.value ?? '').trim().toLowerCase() === 'true'
  } catch {
    return false
  }
}

/** Adds "not a moved ZOHO- ticket" to a request query when moved tickets are silent. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withoutSilentMoved<Q extends { not: (c: string, op: string, v: string) => any }>(query: Q, active: boolean): any {
  return active ? query : query.not('request_no', 'like', ZOHO_NUMBER_LIKE)
}

export const isMovedRequestNo = (requestNo: string | null | undefined) => /^ZOHO-\d{1,18}$/.test(String(requestNo ?? ''))
