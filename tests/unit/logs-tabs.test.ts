import { describe, it, expect } from 'vitest'
import { resolveLogsView } from '@/lib/syslog/log-tabs'

describe('which log screen a person gets', () => {
  it('administrators and platform owners get the System Log (all records) and the Event Log', () => {
    for (const role of ['admin', 'platform_owner']) {
      expect(resolveLogsView(role, undefined, undefined)).toEqual({ tab: 'system', view: 'all', isAdmin: true })
      expect(resolveLogsView(role, 'system', undefined)).toEqual({ tab: 'system', view: 'all', isAdmin: true })
      expect(resolveLogsView(role, 'events', undefined)).toEqual({ tab: 'events', view: 'all', isAdmin: true })
    }
  })
  it('the old Audit Log tab (and its old links) opens the ticket and task activity view inside the System Log', () => {
    expect(resolveLogsView('admin', 'audit', undefined)).toEqual({ tab: 'system', view: 'activity', isAdmin: true })
    expect(resolveLogsView('admin', 'system', 'activity')).toEqual({ tab: 'system', view: 'activity', isAdmin: true })
  })
  it('a manager only ever gets the ticket and task activity, whatever the address says', () => {
    for (const tab of [undefined, 'system', 'audit', 'events']) {
      expect(resolveLogsView('manager', tab, undefined)).toEqual({ tab: 'system', view: 'activity', isAdmin: false })
      expect(resolveLogsView('manager', tab, 'all')).toEqual({ tab: 'system', view: 'activity', isAdmin: false })
    }
  })
  it('nobody else gets any log', () => {
    for (const role of ['agent', 'user', 'requester', '']) expect(resolveLogsView(role, 'system', undefined)).toBeNull()
  })
})
