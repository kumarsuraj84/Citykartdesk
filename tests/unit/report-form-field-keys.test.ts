import { describe, expect, it } from 'vitest'
import { toReportFields } from '@/lib/queries/reporting'
import type { ServiceFormFieldRef } from '@/lib/forms/sections'

// QA 2026-11 UI-006: the Pivot/report field list showed React "two children with the same key" for form:f_subject and form:f_desc.
// Cause: two services whose forms use the same field id (older seeded forms) produce two picker entries with one key. A request's answers are
// read by that id, so the entries are the same column; the list must hold ONE entry per key (and the picker must not show duplicate keys).
const f = (over: Partial<ServiceFormFieldRef>): ServiceFormFieldRef => ({ id: 'f_subject', label: 'Subject', type: 'text', serviceId: 's1', serviceName: 'Service One', ...over })

describe('report fields from service forms', () => {
  it('two services using the same field id give one report field per key', () => {
    const out = toReportFields([f({}), f({ serviceId: 's2', serviceName: 'Service Two' }), f({ id: 'f_desc', label: 'Description', type: 'textarea' }), f({ id: 'f_desc', label: 'Description', type: 'textarea', serviceId: 's2', serviceName: 'Service Two' })])
    const keys = out.map((x) => x.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.sort()).toEqual(['form:f_desc', 'form:f_subject'])
  })
  it('a shared field is named without one service in front, so the label does not claim it belongs to a single service', () => {
    const out = toReportFields([f({}), f({ serviceId: 's2', serviceName: 'Service Two' })])
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('Subject')
  })
  it('a field that only one service has keeps its service name in front', () => {
    const out = toReportFields([f({ id: 'only_here', label: 'Serial no' })])
    expect(out[0].label).toBe('Service One: Serial no')
  })
  it('a Field Library field still appears once, under its own name', () => {
    const out = toReportFields([f({ id: 'a', libraryFieldId: 'L1', label: 'Asset tag' }), f({ id: 'b', libraryFieldId: 'L1', label: 'Asset tag', serviceId: 's2', serviceName: 'Service Two' })])
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe('form:lib:L1')
    expect(out[0].label).toBe('Asset tag')
  })
})
