// Which log screen a person gets under Admin > Logs. There are two tabs: the System Log (every important record, which now also holds what the old
// "Audit Log" tab showed as its "Ticket and task activity" view) and the Event Log (page views and clicks, administrators only). A manager cannot read the
// whole System Log, so a manager's System Log tab is the ticket and task activity only. Old links (?tab=audit) land on that view.

export type LogsTab = 'system' | 'events'
export type SystemLogView = 'all' | 'activity'

export interface LogsView { tab: LogsTab; view: SystemLogView; isAdmin: boolean }

export function resolveLogsView(role: string, tab: string | undefined, view: string | undefined): LogsView | null {
  const isAdmin = role === 'admin' || role === 'platform_owner'
  if (!isAdmin && role !== 'manager') return null
  if (!isAdmin) return { tab: 'system', view: 'activity', isAdmin }
  if (tab === 'events') return { tab: 'events', view: 'all', isAdmin }
  return { tab: 'system', view: tab === 'audit' || view === 'activity' ? 'activity' : 'all', isAdmin }
}
