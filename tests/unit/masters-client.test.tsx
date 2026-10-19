// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('@/lib/actions/admin/masters', () => ({
  saveMasterSource: vi.fn(), saveMasterTemplate: vi.fn(), resetMasterTemplate: vi.fn(), disconnectGoogleSheets: vi.fn(), updateMastersNow: vi.fn(),
}))
vi.mock('next/dynamic', () => ({ default: () => () => null }))

import { MastersClient, type SourceView, type IssueView, type TemplateView, type CountsView } from '@/app/(app)/admin/masters/MastersClient'

afterEach(() => cleanup())

const counts: CountsView = { acActive: 12, acInactive: 2, acRemoved: 1, gensetActive: 5, gensetRemoved: 0, cvmStores: 3 }
const templates: TemplateView[] = [
  { kind: 'ac', subject: 'New AC Issue Ticket', body: '<p>Hi</p>', custom: false },
  { kind: 'genset', subject: 'New Genset Issue Ticket', body: '<p>Hi</p>', custom: true },
]
const source = (kind: SourceView['kind'], extra: Partial<SourceView> = {}): SourceView => ({
  kind, spreadsheet_id: 'abcdefghijklmnopqrstuvwxyz0123456789', tab_name: null, last_checked_at: null, last_applied_at: null, last_status: 'ok', last_error: null, row_count: 16, ...extra,
})
const issues: IssueView[] = [
  { kind: 'genset', severity: 'warning', code: 'probable_typo_domain', store_code: 'MDB', sheet_row: 9, message: 'Row 9 (MDB): x@citylartstores.com looks like a misspelt company address.' },
  { kind: 'ac', severity: 'error', code: 'duplicate_number', store_code: 'PAR', sheet_row: 4, message: 'Rows 3 and 4: PAR has the AC number 3 twice.' },
]

describe('Admin > Sheet Masters page', () => {
  it('shows the three-times-a-day schedule, the counts, the sheets and the problems', () => {
    render(<MastersClient googleResult={null} connection={{ account_email: 'citykartdesk@citykartstores.com', status: 'connected', last_error: null, connected_at: '2026-10-19T05:00:00Z' }} sources={[source('ac'), source('genset'), source('cvm')]} issues={issues} templates={templates} counts={counts} />)
    expect(screen.getByText(/11:00, 15:00, 19:00/)).toBeTruthy()
    expect(screen.getByText('Update from sheets now')).toBeTruthy()
    expect(screen.getByText('citykartdesk@citykartstores.com')).toBeTruthy()
    expect(screen.getByText('AC DETAILS MASTER SHEET-ADMIN')).toBeTruthy()
    expect(screen.getByText('GENSET Detail MASTER SHEET-ADMIN')).toBeTruthy()
    expect(screen.getByText('CVM Detail MASTER SHEET-ADMIN (for Approval)')).toBeTruthy()
    expect(screen.getByText('Active ACs')).toBeTruthy()
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText(/PAR has the AC number 3 twice/)).toBeTruthy()
    expect(screen.getByText(/misspelt company address/)).toBeTruthy()
    expect(screen.getByText('AC OEM e-mail')).toBeTruthy()
    expect(screen.getByText('Genset OEM e-mail')).toBeTruthy()
  })

  it('before the connection is made it asks to connect and cannot update', () => {
    render(<MastersClient googleResult={null} connection={null} sources={[]} issues={[]} templates={templates} counts={counts} />)
    expect(screen.getAllByText('Connect Google Sheets').length).toBeGreaterThan(0)
    expect((screen.getByText('Update from sheets now') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('No problems found in the sheets.')).toBeTruthy()
  })

  it('shows a sheet that cannot be read, and says the last good copy keeps working', () => {
    render(<MastersClient googleResult="connected" connection={{ account_email: 'a@b.test', status: 'connected', last_error: null, connected_at: '' }} sources={[source('ac', { last_status: 'error', last_error: 'The AC sheet is missing the column(s): Store Code.' })]} issues={[]} templates={templates} counts={counts} />)
    expect(screen.getByText(/missing the column/)).toBeTruthy()
    expect(screen.getByText(/keeps working with the last good copy/)).toBeTruthy()
    expect(screen.getByText(/Google Sheets is connected/)).toBeTruthy()
  })

  it('a lost connection asks to connect again', () => {
    render(<MastersClient googleResult={null} connection={{ account_email: 'a@b.test', status: 'broken', last_error: 'Google no longer accepts the saved connection.', connected_at: '' }} sources={[]} issues={[]} templates={templates} counts={counts} />)
    expect(screen.getByText(/Connection lost for/)).toBeTruthy()
    expect(screen.getByText('Connect again')).toBeTruthy()
  })
})
