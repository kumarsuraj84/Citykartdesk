import { DEFAULT_AUTO_RESOLVE_HOURS, DEFAULT_REMINDER_HOURS } from './constants'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type VisitSettings = { autoResolveHours: number; reminderHours: number }

/** The hours an administrator set (48 and 24 unless changed). */
export async function getVisitSettings(db: Db, orgId: string): Promise<VisitSettings> {
  const { data } = await db.from('ac_visit_settings').select('auto_resolve_hours, reminder_hours').eq('org_id', orgId).maybeSingle()
  return {
    autoResolveHours: Number(data?.auto_resolve_hours ?? DEFAULT_AUTO_RESOLVE_HOURS),
    reminderHours: Number(data?.reminder_hours ?? DEFAULT_REMINDER_HOURS),
  }
}
