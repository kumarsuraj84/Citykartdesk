import { describe, expect, it } from 'vitest'
import { isZohoRequestNo, zohoRequestNo } from '@/lib/zoho/transfer/number'
import { bestMatch, nameScore, suggestStatus } from '@/lib/zoho/transfer/suggest'
import { categoryKey, fieldKey, itemKey, planTicket, serviceKey, type CkService, type CkTemplate, type Mappings, type PersonMatch, type ZohoTicketForPlan } from '@/lib/zoho/transfer/plan'

describe('ZOHO ticket number', () => {
  it('is ZOHO- plus the Zoho number exactly as Zoho has it', () => {
    expect(zohoRequestNo(48213)).toBe('ZOHO-48213')
    expect(zohoRequestNo('48213')).toBe('ZOHO-48213')
    expect(zohoRequestNo(' 129571 ')).toBe('ZOHO-129571')
  })
  it('keeps a zero when Zoho has it and never adds one', () => {
    expect(zohoRequestNo('000123')).toBe('ZOHO-000123')
    expect(zohoRequestNo(7)).toBe('ZOHO-7')
  })
  it('refuses anything that is not a plain number', () => {
    expect(zohoRequestNo('')).toBeNull()
    expect(zohoRequestNo('12a')).toBeNull()
    expect(zohoRequestNo('-5')).toBeNull()
    expect(zohoRequestNo(null as unknown as string)).toBeNull()
  })
  it('recognises a moved ticket number', () => {
    expect(isZohoRequestNo('ZOHO-48213')).toBe(true)
    expect(isZohoRequestNo('IT-000123')).toBe(false)
    expect(isZohoRequestNo(null)).toBe(false)
  })
})

describe('mapping suggestions', () => {
  it('matches names that are alike and leaves unlike names alone', () => {
    expect(nameScore('Not cooling', 'AC Not Cooling')).toBeGreaterThanOrEqual(0.5)
    expect(nameScore('Payroll query', 'AC Not Cooling')).toBe(0)
    const options = [{ id: 'a', name: 'ADMIN - AC' }, { id: 'b', name: 'Network' }]
    expect(bestMatch('Admin AC Service', options)?.id).toBe('a')
    expect(bestMatch('Something else entirely', options)).toBeNull()
  })
  it('suggests a CK Desk status for each Zoho status', () => {
    expect(suggestStatus('Open')).toBe('open')
    expect(suggestStatus('In Process')).toBe('in_progress')
    expect(suggestStatus('Closed')).toBe('closed')
    expect(suggestStatus('Resolved')).toBe('resolved')
    expect(suggestStatus('Reject')).toBe('cancelled')
    expect(suggestStatus('Rejected')).toBe('cancelled')
    expect(suggestStatus('On Hold Due to Purchase from HO')).toBe('hold_purchase_ho')
    expect(suggestStatus('On Hold Due to Approval')).toBe('pending_approval')
    expect(suggestStatus('On Hold as Requester Intervention Required')).toBe('waiting_user')
    expect(suggestStatus('Support from OEM/Vendor')).toBe('in_progress')
    expect(suggestStatus('Something new')).toBeNull()
  })
})

const SVC: CkService = {
  id: 'svc-ac', name: 'AC Repair', defaultPriority: 'medium', templateId: 'tpl-ac',
  subCategories: [
    { id: 'sc-cool', name: 'Not cooling', categoryId: 'c-complaint', categoryName: 'Complaint', slaPriority: 'high' },
    { id: 'sc-noise', name: 'Noise', categoryId: 'c-complaint', categoryName: 'Complaint', slaPriority: null },
    { id: 'sc-solo', name: 'Gas refill', categoryId: 'c-service', categoryName: 'Service', slaPriority: null },
  ],
}
const SVC_PLAIN: CkService = { id: 'svc-plain', name: 'Network', defaultPriority: 'low', templateId: 'tpl-general', subCategories: [] }
const services = new Map([[SVC.id, SVC], [SVC_PLAIN.id, SVC_PLAIN]])
const templates = new Map<string, CkTemplate>([['tpl-ac', { id: 'tpl-ac', name: 'AC TEMPLATE' }], ['tpl-general', { id: 'tpl-general', name: 'GENERAL TEMPLATE' }]])

const maps = (over: Partial<Mappings> = {}): Mappings => ({
  templates: new Map([['AC Issues', 'tpl-ac'], ['Net', 'tpl-general'], ['Generic', 'tpl-general']]),
  services: new Map([[serviceKey('AC Issues', 'Admin-AC'), 'svc-ac'], [serviceKey('Net', ''), 'svc-plain']]),
  categories: new Map([[categoryKey('AC Issues', 'Admin-AC', 'Repair'), 'c-complaint'], [categoryKey('AC Issues', 'Admin-AC', 'Maintenance'), 'c-service']]),
  items: new Map([[itemKey('AC Issues', 'Admin-AC', 'Repair', 'Split AC'), 'sc-cool']]),
  fields: new Map([[fieldKey('AC Issues', 'ac_number'), 'f_ac']]),
  statuses: new Map([['Closed', 'closed'], ['Open', 'open']]),
  ...over,
})

const ticket = (over: Partial<ZohoTicketForPlan> = {}): ZohoTicketForPlan => ({
  displayId: 48213, template: 'AC Issues', category: 'Admin-AC', subcategory: 'Repair', item: 'Split AC', status: 'Closed', priority: 'High',
  subject: 'AC not cooling', createdAt: '2026-01-05T04:30:00.000Z', resolvedAt: '2026-01-07T04:30:00.000Z',
  requesterName: 'S0123', requesterEmail: 's0123@example.test', technicianName: 'Ravi', fields: { ac_number: '3', ac_floor: '1' }, ...over,
})
const known: PersonMatch = { how: 'email', profileName: 'Store 0123' }
const plan = (t: ZohoTicketForPlan, m = maps(), o: { requester?: PersonMatch; technician?: PersonMatch; alreadyMoved?: boolean } = {}) =>
  planTicket({ ticket: t, maps: m, services, templates, requester: o.requester ?? known, technician: o.technician ?? { how: 'email', profileName: 'Ravi K' }, alreadyMoved: !!o.alreadyMoved })
const codes = (p: ReturnType<typeof plan>) => p.problems.map((x) => x.code)

describe("the owner's mapping: Template -> Template, Template + Category -> Service, Sub Category -> Category, Item -> Sub Category", () => {
  it('moves a fully mapped ticket and keeps the Zoho number and created time', () => {
    const p = plan(ticket())
    expect(p.ready).toBe(true)
    expect(p.newNo).toBe('ZOHO-48213')
    expect(p.createdAt).toBe('2026-01-05T04:30:00.000Z')
    expect(p.template?.name).toBe('AC TEMPLATE')
    expect(p.service?.name).toBe('AC Repair')
    expect(p.category).toEqual({ id: 'c-complaint', name: 'Complaint' })
    expect(p.subCategory).toEqual({ id: 'sc-cool', name: 'Not cooling' })
    expect(p.status).toBe('closed')
  })
  it('blocks a ticket whose Zoho template is not mapped to a CK Desk form template', () => {
    expect(codes(plan(ticket({ template: 'Brand new Zoho template' })))).toContain('template_unmapped')
  })
  it('blocks a service that does not use the form template the Zoho template is mapped to', () => {
    const m = maps({ templates: new Map([['AC Issues', 'tpl-general']]) })
    expect(codes(plan(ticket(), m))).toContain('service_template_mismatch')
  })
  it('decides the service from the Zoho template AND category, falling back to the template alone', () => {
    const m = maps({ services: new Map([[serviceKey('Generic', 'Admin-AC'), 'svc-ac'], [serviceKey('Generic', 'Network'), 'svc-plain'], [serviceKey('Generic', ''), 'svc-plain']]) })
    expect(plan(ticket({ template: 'Generic', category: 'Network', subcategory: null, item: null }), m).service?.id).toBe('svc-plain')
    expect(plan(ticket({ template: 'Generic', category: 'Something else', subcategory: null, item: null }), m).service?.id).toBe('svc-plain') // the template's default
    expect(plan(ticket({ template: 'Generic', category: 'Admin-AC' }), m).service?.id).toBe('svc-ac')
  })
  it('uses the only sub-category of a category when there is no choice to make', () => {
    const p = plan(ticket({ subcategory: 'Maintenance', item: 'Gas' }))
    expect(p.ready).toBe(true)
    expect(p.subCategory?.id).toBe('sc-solo')
  })
  it("gets the priority from CK Desk's own rule, not from Zoho", () => {
    expect(plan(ticket()).priority).toBe('high') // the sub-category's SLA priority
    expect(plan(ticket({ subcategory: 'Maintenance', item: 'x' })).priority).toBe('medium') // none on the sub-category: the service's default
    expect(plan(ticket({ template: 'Net', category: null, subcategory: null, item: null })).priority).toBe('low')
  })
  it('blocks a ticket whose service is not mapped, and says why', () => {
    const p = plan(ticket({ category: 'A category nobody mapped' }))
    expect(p.ready).toBe(false)
    expect(codes(p)).toContain('service_unmapped')
  })
  it('blocks a ticket whose Zoho sub category is not mapped to a CK Desk category', () => {
    expect(codes(plan(ticket({ subcategory: 'Unknown sub category' })))).toContain('category_unmapped')
  })
  it('blocks a ticket whose Zoho item is not mapped when the category has more than one sub-category', () => {
    expect(codes(plan(ticket({ item: 'Window AC' })))).toContain('sub_category_unmapped')
  })
  it('blocks a sub-category that is not in the mapped category', () => {
    const m = maps({ items: new Map([[itemKey('AC Issues', 'Admin-AC', 'Repair', 'Split AC'), 'sc-solo']]) })
    expect(codes(plan(ticket(), m))).toContain('sub_category_wrong')
  })
  it('a CK Desk service with no sub-categories needs no category or item', () => {
    const p = plan(ticket({ template: 'Net', category: null, subcategory: null, item: null }))
    expect(p.ready).toBe(true)
    expect(p.category).toBeNull()
  })
  it('blocks an unmapped status, a missing created time, and a ticket already moved', () => {
    expect(codes(plan(ticket({ status: 'Weird' })))).toContain('status_unmapped')
    expect(codes(plan(ticket({ createdAt: null })))).toContain('no_created_time')
    expect(codes(plan(ticket(), maps(), { alreadyMoved: true }))).toContain('already_moved')
  })
})

describe('people and fields in the plan', () => {
  it('a requester CK Desk does not know becomes a new inactive profile (a warning, not a block)', () => {
    const p = plan(ticket(), maps(), { requester: { how: 'none' } })
    expect(p.requester.how).toBe('new-inactive')
    expect(p.ready).toBe(true)
  })
  it('shows which CK Desk person the Zoho technician matches, and does not block when there is none', () => {
    expect(plan(ticket()).technician).toEqual({ zohoName: 'Ravi', ckName: 'Ravi K', how: 'email' })
    const none = plan(ticket(), maps(), { technician: { how: 'none' } })
    expect(none.technician.ckName).toBeNull()
    expect(none.ready).toBe(true)
  })
  it('lists the Zoho fields that are mapped and the ones that are not', () => {
    const p = plan(ticket())
    expect(p.mappedFields).toEqual([{ zohoField: 'ac_number', ckFieldId: 'f_ac', value: '3' }])
    expect(p.unmappedFields).toEqual(['ac_floor'])
  })
})
