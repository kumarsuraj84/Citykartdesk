import { describe, expect, it } from 'vitest'
import { cloneSectionsWithFreshIds } from '@/lib/forms/sections'
import { buildUsersExportRows, USER_EXPORT_COLUMNS, type ExportProfile } from '@/lib/export/users'
import { toCSV } from '@/lib/export/csv'
import type { FormSection } from '@/types'

describe('cloneSectionsWithFreshIds (Duplicate template)', () => {
  const source: FormSection[] = [
    {
      id: 's1', title: 'Details', order: 0,
      fields: [
        { id: 'f1', type: 'text', label: 'Subject', required: true, order: 0, requester_can_view: false },
        { id: 'f2', type: 'select', label: 'Mode', required: false, order: 1, library_field_id: 'lib-1',
          options: [{ value: 'o1', label: 'Air' }, { value: 'o2', label: 'Road' }] },
      ],
    },
  ]
  let n = 0
  const newId = () => `new-${++n}`

  it('gives every section and field a brand-new unique id', () => {
    n = 0
    const out = cloneSectionsWithFreshIds(source, newId)
    const ids = [out[0].id, ...out[0].fields.map((f) => f.id)]
    expect(new Set(ids).size).toBe(3)
    expect(ids.some((id) => ['s1', 'f1', 'f2'].includes(id))).toBe(false)
  })

  it('keeps everything else: labels, required, visibility, library link, option ids', () => {
    const out = cloneSectionsWithFreshIds(source, newId)
    expect(out[0].title).toBe('Details')
    expect(out[0].fields[0]).toMatchObject({ label: 'Subject', required: true, requester_can_view: false })
    expect(out[0].fields[1]).toMatchObject({ library_field_id: 'lib-1' })
    expect(out[0].fields[1].options).toEqual(source[0].fields[1].options)
  })

  it('does not share option objects with the source (editing the copy must not touch the original)', () => {
    const out = cloneSectionsWithFreshIds(source, newId)
    out[0].fields[1].options![0].label = 'CHANGED'
    expect(source[0].fields[1].options![0].label).toBe('Air')
  })
})

describe('buildUsersExportRows (Export users)', () => {
  const p = (over: Partial<ExportProfile>): ExportProfile => ({
    id: 'u1', full_name: 'Priya Sharma', role: 'agent', is_active: true, whatsapp_enabled: true,
    job_title: 'IT Executive', employee_id: 'EMP1', department_id: 'd1', location_id: 'l1', store_id: 's1',
    manager_id: 'm1', function_id: null, designation_id: null, cost_center_id: null, created_at: '2026-09-01T10:00:00Z', ...over,
  })
  const base = {
    emailById: new Map([['u1', 'priya@citykart.org'], ['m1', 'boss@citykart.org']]),
    departments: [{ id: 'd1', name: 'IT Support' }],
    locations: [{ id: 'l1', name: 'HO' }],
    stores: [{ id: 's1', code: 'ALC' }],
    jobFunctions: [], designations: [], costCenters: [],
    mobileNumbersById: new Map([['u1', ['9876543210', '9811111111']]]),
    teamNamesById: new Map([['u1', ['IT', 'Helpdesk']]]),
  }

  it('resolves ids to the names/emails the importer expects', () => {
    const [row] = buildUsersExportRows({ ...base, profiles: [p({})] })
    expect(row).toMatchObject({
      full_name: 'Priya Sharma', email: 'priya@citykart.org', role: 'agent', department: 'IT Support',
      location: 'HO', store: 'ALC', job_title: 'IT Executive', employee_id: 'EMP1',
      manager_email: 'boss@citykart.org', mobile_number: '9876543210', whatsapp_enabled: 'true',
      status: 'active', teams: 'IT; Helpdesk', all_mobile_numbers: '9876543210; 9811111111', created_at: '2026-09-01',
    })
  })

  it('leaves blanks for missing links and marks inactive users', () => {
    const [row] = buildUsersExportRows({
      ...base,
      profiles: [p({ id: 'u2', department_id: null, manager_id: null, is_active: false, whatsapp_enabled: false })],
    })
    expect(row).toMatchObject({ email: '', department: '', manager_email: '', mobile_number: '', status: 'inactive', whatsapp_enabled: 'false' })
  })

  it('never exports a password column, and the import columns come first', () => {
    expect(USER_EXPORT_COLUMNS.map((c) => c.key)).not.toContain('password')
    expect(USER_EXPORT_COLUMNS.slice(0, 3).map((c) => c.key)).toEqual(['full_name', 'email', 'role'])
  })

  it('produces a CSV whose header matches the import template columns', () => {
    const csv = toCSV(buildUsersExportRows({ ...base, profiles: [p({})] }), USER_EXPORT_COLUMNS)
    const header = csv.split('\r\n')[0].split(',')
    for (const col of ['full_name', 'email', 'role', 'department', 'location', 'store', 'job_title', 'employee_id', 'manager_email', 'mobile_number', 'whatsapp_enabled']) {
      expect(header).toContain(col)
    }
  })
})
