import { describe, it, expect } from 'vitest'
import { defaultReportColumnKeys, getEntityFields, RECORD_COUNT_FIELD, type ReportField } from '@/lib/reporting/field-registry'

const libraryDescription: ReportField = { key: 'lib:desc', label: 'Description', type: 'string', groupable: false, isCustomField: true }

describe('defaultReportColumnKeys', () => {
  it('uses the "Description (Custom Field)" column in place of the native description', () => {
    const fields = [RECORD_COUNT_FIELD, ...getEntityFields('requests', [libraryDescription])]
    const keys = defaultReportColumnKeys(fields)
    expect(keys).toEqual(['request_no', 'title', 'lib:desc', 'status', 'priority', 'service_name'])
    expect(keys).not.toContain('description')
  })

  it('keeps the native description when no Description custom field exists', () => {
    const fields = [RECORD_COUNT_FIELD, ...getEntityFields('requests', [])]
    expect(defaultReportColumnKeys(fields)).toEqual(['request_no', 'title', 'description', 'status', 'priority', 'service_name'])
  })

  it('never includes the synthetic record count in the defaults', () => {
    const fields = [RECORD_COUNT_FIELD, ...getEntityFields('tasks', [])]
    expect(defaultReportColumnKeys(fields)).not.toContain('__count__')
  })
})
