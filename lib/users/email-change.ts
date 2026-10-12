// What a change of someone's sign-in e-mail does besides changing the sign-in account (see the replace_user_email function in
// supabase/migrations/20240101000155_replace_user_email.sql), and how it is told to the admin. Pure, so the wording and the address
// check are easy to test.

/**
 * An ordinary e-mail address: letters, digits and . _ % + ' - before the @, and a domain of letters, digits and hyphens with a dot.
 * Deliberately stricter than the full standard: an address in the system must be safe to copy into templates and rules.
 */
const ADDRESS = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/

export function isUsableEmail(email: string): boolean {
  return email.length <= 254 && ADDRESS.test(email)
}

/** How many rows were changed in each place (what the database function returns). */
export type EmailChangeCounts = Partial<Record<
  'oems' | 'teams' | 'scheduled_reports' | 'intake_threads' | 'request_comments' | 'desktime_time_logs' | 'desktime_app_logs' | 'business_rules' | 'escalation_policies',
  number
>>

const PLACES: { key: keyof EmailChangeCounts; one: string; many: string }[] = [
  { key: 'oems', one: 'OEM contact list or template', many: 'OEM contact lists or templates' },
  { key: 'teams', one: 'technician group notification address', many: 'technician group notification addresses' },
  { key: 'scheduled_reports', one: 'scheduled report', many: 'scheduled reports' },
  { key: 'intake_threads', one: 'e-mail conversation', many: 'e-mail conversations' },
  { key: 'request_comments', one: 'e-mailed reply on a ticket', many: 'e-mailed replies on tickets' },
  { key: 'desktime_time_logs', one: 'DeskTime time log', many: 'DeskTime time logs' },
  { key: 'desktime_app_logs', one: 'DeskTime app log', many: 'DeskTime app logs' },
  { key: 'business_rules', one: 'business rule', many: 'business rules' },
  { key: 'escalation_policies', one: 'escalation policy', many: 'escalation policies' },
]

/** "2 OEM contact lists or templates, 1 business rule" — what else was updated; '' when the old address was nowhere else. */
export function describeEmailUpdates(counts: EmailChangeCounts | null | undefined): string {
  if (!counts) return ''
  return PLACES
    .filter((p) => (counts[p.key] ?? 0) > 0)
    .map((p) => `${counts[p.key]} ${counts[p.key] === 1 ? p.one : p.many}`)
    .join(', ')
}
