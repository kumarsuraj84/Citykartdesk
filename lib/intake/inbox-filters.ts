// What each Intake inbox folder, filter and sort means, as conditions on the columns of the view public.intake_inbox_v (migration 195). A plain module, shared by
// the server query (lib/queries/intake) and the page, so the folder names, the counts and the lists can never disagree.

export const INBOX_FOLDER_KEYS = ['all', 'urgent', 'starred', 'escalated', 'unread', 'request', 'task', 'approval', 'converted', 'rest'] as const
export type InboxFolderKey = (typeof INBOX_FOLDER_KEYS)[number]

export const INBOX_SORTS = ['priority_smart', 'date_desc', 'date_asc', 'confidence_desc', 'confidence_asc'] as const
export type InboxSort = (typeof INBOX_SORTS)[number]

export const INBOX_STAGES = ['all', 'rule', 'local_model', 'premium_ai'] as const

export const INBOX_PAGE_SIZE = 50

export const parseInboxFolder = (v: string | undefined | null): InboxFolderKey => (INBOX_FOLDER_KEYS as readonly string[]).includes(v ?? '') ? (v as InboxFolderKey) : 'all'
export const parseInboxSort = (v: string | undefined | null): InboxSort => (INBOX_SORTS as readonly string[]).includes(v ?? '') ? (v as InboxSort) : 'priority_smart'
export const parseInboxStage = (v: string | undefined | null): (typeof INBOX_STAGES)[number] => (INBOX_STAGES as readonly string[]).includes(v ?? '') ? (v as (typeof INBOX_STAGES)[number]) : 'all'

// The query builder of the data client, as far as the filters need it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any

/** Narrows a query to one folder. "Rest" is everything that is not actionable work: archived, informational / ignore mail, and mail not classified yet. */
export function applyInboxFolder(q: Q, folder: InboxFolderKey): Q {
  switch (folder) {
    case 'all':       return q.eq('is_archived', false)
    case 'urgent':    return q.eq('is_archived', false).or('suggested_priority.eq.urgent,is_escalated.eq.true')
    case 'starred':   return q.eq('is_archived', false).eq('is_starred', true)
    case 'escalated': return q.eq('is_archived', false).eq('is_escalated', true)
    case 'unread':    return q.eq('is_archived', false).eq('is_read', false)
    case 'request':   return q.eq('is_archived', false).eq('suggested_type', 'request')
    case 'task':      return q.eq('is_archived', false).eq('suggested_type', 'task')
    case 'approval':  return q.eq('is_archived', false).eq('suggested_type', 'approval')
    case 'converted': return q.eq('is_archived', false).eq('review_state', 'converted')
    case 'rest':      return q.or('is_archived.eq.true,suggested_type.in.(informational,ignore),review_id.is.null')
  }
}

/**
 * The search text made safe to put inside a filter expression: the characters that have a meaning there (comma, brackets, quotes, the wildcard characters and
 * the backslash) become spaces, and the length is capped. Returns '' when nothing searchable is left.
 */
export function cleanInboxSearch(raw: string | undefined | null): string {
  return String(raw ?? '').replace(/[,()*%_\\:"'`;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** Narrows a query to messages whose subject, sender, department or mailbox contains the text (all case-insensitive). */
export function applyInboxSearch(q: Q, search: string): Q {
  if (!search) return q
  const like = `*${search}*`
  return q.or(`subject.ilike.${like},from_address.ilike.${like},suggested_department.ilike.${like},channel_name.ilike.${like}`)
}

/** The order of the list. Ties fall back to the newest first, as the in-browser sort did. */
export function applyInboxSort(q: Q, sort: InboxSort): Q {
  switch (sort) {
    case 'priority_smart':   return q.order('priority_score', { ascending: false }).order('received_at', { ascending: false, nullsFirst: false })
    case 'date_asc':         return q.order('received_at', { ascending: true, nullsFirst: false })
    case 'date_desc':        return q.order('received_at', { ascending: false, nullsFirst: false })
    case 'confidence_desc':  return q.order('suggested_confidence', { ascending: false, nullsFirst: false }).order('received_at', { ascending: false, nullsFirst: false })
    case 'confidence_asc':   return q.order('suggested_confidence', { ascending: true, nullsFirst: false }).order('received_at', { ascending: false, nullsFirst: false })
  }
}
