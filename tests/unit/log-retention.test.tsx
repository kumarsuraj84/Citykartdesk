// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const updateLog = vi.hoisted(() => vi.fn())
vi.mock('@/lib/actions/admin/config', () => ({
  updateEmailFromSettings: vi.fn(), updateRetentionPolicy: vi.fn(), updateLogRetention: updateLog, sendTestEmail: vi.fn(), saveMailboxSettings: vi.fn(), clearMailboxSettings: vi.fn(),
}))

import { SettingsClient } from '@/app/(app)/admin/settings/SettingsClient'
import { logRetentionDays, checkLogRetentionDays, readLogRetention, LOG_RETENTION } from '@/lib/syslog/retention'

afterEach(() => { cleanup(); updateLog.mockReset() })

describe('how long the System Log and the Event Log are kept', () => {
  it('uses the usual numbers (180 and 90) unless a valid number was saved', () => {
    expect(logRetentionDays('system_log', undefined)).toBe(180)
    expect(logRetentionDays('event_log', null)).toBe(90)
    expect(logRetentionDays('system_log', '365')).toBe(365)
    expect(logRetentionDays('event_log', '30')).toBe(30)
    expect(logRetentionDays('system_log', '5')).toBe(180)       // below the least allowed
    expect(logRetentionDays('event_log', 'abc')).toBe(90)
    expect(logRetentionDays('event_log', '12.5')).toBe(90)
  })
  it('checks what an administrator types', () => {
    expect(checkLogRetentionDays('system_log', 365)).toBeNull()
    expect(checkLogRetentionDays('system_log', 10)).toMatch(/at least 30/)
    expect(checkLogRetentionDays('event_log', 3)).toMatch(/at least 7/)
    expect(checkLogRetentionDays('event_log', 99999)).toMatch(/at most 3650/)
    expect(checkLogRetentionDays('event_log', 7.5)).toMatch(/whole number/)
  })
  it('the nightly jobs read both numbers from the saved settings', async () => {
    const rows = [{ key: LOG_RETENTION.system_log.key, value: '365' }, { key: LOG_RETENTION.event_log.key, value: '45' }]
    const admin = { from: () => ({ select: () => ({ in: async () => ({ data: rows }) }) }) }
    expect(await readLogRetention(admin)).toEqual({ system_log: 365, event_log: 45 })
    const broken = { from: () => { throw new Error('no table') } }
    expect(await readLogRetention(broken)).toEqual({ system_log: 180, event_log: 90 })
  })
})

describe('Platform Settings > Retention lists the System Log and the Event Log beside the Audit Log', () => {
  const props = {
    retentionPolicies: [{ id: 'p1', entity_type: 'audit_log', retention_days: 2555, archive_after_days: null, purge_after_days: 2555, is_active: true }],
    logRetention: { system_log: 180, event_log: 90 },
    integrationStatus: { provider: null, detail: null, sendingAs: null, source: null }, mailbox: null, canEditMailbox: false, emailFrom: { name: '', address: '' }, whatsappChannels: [],
  }
  it('shows all three and saves a new number for a log', async () => {
    updateLog.mockResolvedValue({})
    render(<SettingsClient {...props} />)
    expect(screen.getByText('Audit Logs')).toBeTruthy()
    expect(screen.getByText('System Log')).toBeTruthy()
    expect(screen.getByText('Event Log')).toBeTruthy()
    expect(screen.getByText('90d')).toBeTruthy()
    fireEvent.click(screen.getAllByText('Edit')[2])                 // the Event Log row (audit log first, then the System Log)
    fireEvent.change(screen.getByLabelText('Event Log days to keep'), { target: { value: '60' } })
    fireEvent.click(screen.getByText('Save'))
    await waitFor(() => expect(updateLog).toHaveBeenCalledWith('event_log', 60))
  })
  it('shows the reason when the number is refused', async () => {
    updateLog.mockResolvedValue({ error: 'Keep at least 7 days.' })
    render(<SettingsClient {...props} />)
    fireEvent.click(screen.getAllByText('Edit')[2])
    fireEvent.click(screen.getByText('Save'))
    expect(await screen.findByText('Keep at least 7 days.')).toBeTruthy()
  })
})
