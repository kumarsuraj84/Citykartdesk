// The event catalog for the admin "Notification Rules" screen (Request
// Configuration → Notification Rules). One row per distinct notify() `type`
// — notify() gates all three channels per (org_id, type), so there's no
// separate "audience" dimension: a type fired at both a requester and a
// technician (e.g. request_created) is governed by one row either way.
//
// Deliberately excludes:
//   - sla_warning / sla_breached / approval_decided — enum values no code
//     path ever fires, so a toggle for them would be a silent no-op.
//   - task_due_soon / task_overdue / milestone_due_soon / milestone_overdue /
//     daily_digest — already configured per-rule on the Alert Rules tab
//     (which has its own channel picker). A second, coarser org-wide toggle
//     for the same event here would just be a confusing double-gate: two
//     screens that can each turn the same notification off.
//   - business_rule_notification — same reasoning, already configured
//     per-rule on the Business Rules screen's "Notify" action.
// This is the pruned set — every row below maps to a real notify() call
// site with no other screen already controlling its channels.

export type NotificationRuleRow = {
  type: string
  label: string
  hint?: string
}

export type NotificationRuleGroup = {
  label: string
  rows: NotificationRuleRow[]
}

export const NOTIFICATION_RULE_GROUPS: NotificationRuleGroup[] = [
  {
    label: 'Requests',
    rows: [
      { type: 'request_created', label: 'New request submitted' },
      { type: 'status_changed', label: 'Status changed' },
      { type: 'request_resolved', label: 'Request resolved' },
      { type: 'request_closed', label: 'Request closed' },
      { type: 'request_cancelled', label: 'Request cancelled' },
      { type: 'request_reopened', label: 'Request reopened' },
      // No hardcoded window length here on purpose — it's admin-configurable
      // (Request Configuration → General) and a static number here would go
      // stale the moment someone changes it. NotificationRulesClient fills
      // in the live value at render time instead.
      { type: 'request_auto_closed', label: 'Auto-closed after no reply', hint: 'The "not satisfied? reopen it" window elapsed' },
      { type: 'priority_changed', label: 'Priority changed' },
    ],
  },
  {
    label: 'Assignment',
    rows: [
      { type: 'request_assigned', label: 'Ticket assigned' },
      { type: 'request_reassigned', label: 'Ticket reassigned' },
      { type: 'request_unassigned', label: 'Ticket unassigned' },
    ],
  },
  {
    label: 'Conversation',
    rows: [
      { type: 'comment_added', label: 'New reply on a request' },
      { type: 'internal_note_added', label: 'Internal note added' },
      { type: 'mentioned', label: '@Mentioned in a note' },
    ],
  },
  {
    label: 'Collaborators',
    rows: [
      { type: 'collaborator_added', label: 'Added as collaborator' },
      { type: 'collaborator_removed', label: 'Removed as collaborator' },
    ],
  },
  {
    label: 'Approvals',
    rows: [
      { type: 'approval_requested', label: 'Approval needed from you' },
      { type: 'approval_approved', label: 'Approval approved' },
      { type: 'approval_rejected', label: 'Approval rejected' },
    ],
  },
  {
    label: 'Tasks',
    rows: [
      { type: 'task_assigned', label: 'Task assigned' },
      { type: 'task_completed', label: 'Task completed' },
    ],
  },
]

export const ALL_NOTIFICATION_EVENT_TYPES: string[] = NOTIFICATION_RULE_GROUPS.flatMap((g) => g.rows.map((r) => r.type))
