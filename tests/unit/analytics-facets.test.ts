import { describe, it, expect } from 'vitest'
import { applyFacets, facetOptions, reconcileSelection, parseFacetSelection, selectionParams, isFacetKey } from '@/lib/reporting/analytics/facets'
import { makeFact, acFormFields, answerText, answerDay, isServerRoomAc, type RawTicket, type AcFormFields } from '@/lib/reporting/analytics/facts'
import { fact } from './helpers/fact'

const rows = [
  fact({ ticketNo: '1', technician: 'Krishan', cluster: 'UP2', region: 'R4', store: 'LAM', ageBucket: '0–5 days', openMonth: 'Oct-26', storeType: 'Regular' }),
  fact({ ticketNo: '2', technician: 'Krishan', cluster: 'UP2', region: 'R4', store: 'ALC', ageBucket: '6–10 days', openMonth: 'Sep-26', storeType: 'NSO' }),
  fact({ ticketNo: '3', technician: 'Shivanshu', cluster: 'BR3', region: 'R2', store: 'SBP', ageBucket: '11–20 days', openMonth: 'Oct-26', storeType: 'Regular' }),
  fact({ ticketNo: '4', technician: 'Shivanshu', cluster: 'BR3', region: 'R2', store: 'SBP', ageBucket: '0–5 days', openMonth: 'Aug-26', storeType: 'Regular' }),
  fact({ ticketNo: '5', technician: 'Unassigned', cluster: '', region: '', store: 'HO Person', ageBucket: '46–60 days', openMonth: 'Oct-26', storeType: '' }),
]

describe('linked filters', () => {
  it('lists each filter\'s values with ticket counts, in a sensible order (people A-Z, Unassigned last, ages by age, months by date)', () => {
    const o = facetOptions(rows, {})
    expect(o.technician).toEqual([{ value: 'Krishan', count: 2 }, { value: 'Shivanshu', count: 2 }, { value: 'Unassigned', count: 1 }])
    expect(o.ageBucket.map((x) => x.value)).toEqual(['0–5 days', '6–10 days', '11–20 days', '46–60 days'])
    expect(o.openMonth.map((x) => x.value)).toEqual(['Aug-26', 'Sep-26', 'Oct-26'])
    // a ticket with no cluster is not offered as a "blank" cluster
    expect(o.cluster.map((x) => x.value)).toEqual(['BR3', 'UP2'])
  })

  it('a filter\'s own choice does not narrow its own list, but every other filter\'s choice does', () => {
    const o = facetOptions(rows, { technician: 'Krishan' })
    expect(o.technician.map((x) => x.value)).toEqual(['Krishan', 'Shivanshu', 'Unassigned']) // can switch to another person
    expect(o.cluster).toEqual([{ value: 'UP2', count: 2 }]) // only Krishan's clusters
    expect(o.store.map((x) => x.value)).toEqual(['ALC', 'LAM'])
    expect(o.ageBucket.map((x) => x.value)).toEqual(['0–5 days', '6–10 days'])
  })

  it('choices chain through several filters: person, then cluster, then the age buckets that are left', () => {
    const sel = { technician: 'Shivanshu', cluster: 'BR3' }
    expect(applyFacets(rows, sel).map((r) => r.ticketNo)).toEqual(['3', '4'])
    const o = facetOptions(rows, sel)
    expect(o.ageBucket.map((x) => x.value)).toEqual(['0–5 days', '11–20 days'])
    expect(o.region).toEqual([{ value: 'R2', count: 2 }])
  })

  it('drops a choice that no longer fits the others, and keeps the ones that do', () => {
    // two choices that cannot both be true: the first one in the filter bar stays
    expect(reconcileSelection(rows, { technician: 'Krishan', cluster: 'BR3' })).toEqual({ technician: 'Krishan' })
    const out = reconcileSelection(rows, { technician: 'Krishan', cluster: 'UP2', ageBucket: '46–60 days' })
    // 46-60 days belongs to nobody in UP2 / Krishan, so it goes; the other two stay
    expect(out).toEqual({ technician: 'Krishan', cluster: 'UP2' })
    expect(reconcileSelection(rows, { cluster: 'NOPE', storeType: 'NSO' })).toEqual({ storeType: 'NSO' })
  })

  it('an empty selection and unknown filters change nothing', () => {
    expect(applyFacets(rows, {})).toBe(rows)
    expect(applyFacets(rows, { technician: '' })).toBe(rows)
    expect(reconcileSelection(rows, {}, ['technician'])).toEqual({})
    expect(isFacetKey('cluster')).toBe(true)
    expect(isFacetKey('colour')).toBe(false)
  })

  it('reads the choices from the page address and writes them back', () => {
    expect(parseFacetSelection({ f_cluster: 'UP2', f_technician: ['Krishan', 'x'], f_region: '', other: 'y' }, ['cluster', 'technician', 'region'])).toEqual({ cluster: 'UP2', technician: 'Krishan' })
    expect(selectionParams({ cluster: 'UP2', region: '' })).toEqual({ f_cluster: 'UP2' })
  })
})

describe('making a ticket fact', () => {
  const fields: AcFormFields = acFormFields([
    { id: 'a1', label: 'AC Serial Number', options: [{ value: 'o1', label: 'Server Room AC' }, { value: 'o9', label: '9' }] },
    { id: 'a2', label: ' AC OEM  Ticket Number ' },
    { id: 'a3', label: 'AC OEM Ticket Creation Date' },
    { id: 'a4', label: 'AC resolution', options: [{ value: 'r1', label: 'PHASE REVERSE' }] },
    { id: 'a5', label: 'Description' },
  ])
  const raw = (o: Partial<RawTicket> = {}): RawTicket => ({
    id: 'x', request_no: 'CK-1', title: 'AC not working', status: 'open', priority: 'high', created_at: '2026-10-01T05:00:00.000Z', resolved_at: null, closed_at: null,
    form_data: { a1: 'o9', a2: 'B26093037138214', a3: '2026-10-02', a4: 'r1' },
    service: { id: 'svc-ac', name: 'ADMIN - AC', auto_oem_routing: true }, category: { name: 'ADMIN AC ISSUE' }, sub_category: { name: 'COOLING ISSUE' }, assignee: { full_name: 'Krishan' },
    requester: { full_name: 'LSR', store: { id: 's1', code: 'LSR', city: ' LAKHISARAI ', state: 'BIHAR', cluster: 'JH1', region: 'R2', priority_list: 'ROS', festival: null, ac_total: 11, ac_brand: 'DAIKIN', ac_amc_brand: 'DAIKIN', ac_amc_vendor: 'SHREYASH', zenatix: true, open_date: '2020-01-01', oem: { name: 'DAIKAIN OEM - ALL' } } },
    ...o,
  })
  const ctx = (open = 2) => ({ asOf: new Date(2026, 9, 12, 12), acFields: new Map([['svc-ac', fields]]), openAcByStore: new Map([['LSR', open]]), redFlagPercent: 30 })

  it('finds the AC fields by their labels and reads what was typed: AC number, OEM ticket number and date, resolution', () => {
    const f = makeFact(raw(), ctx())
    expect(f).toMatchObject({ acNo: '9', oemTicketNo: 'B26093037138214', oemTicketDate: '2026-10-02', acResolution: 'PHASE REVERSE', oemAgeDays: 10, oemBucket: '6–10 days' })
    // no OEM date typed yet: no age at all
    const none = makeFact(raw({ form_data: { a1: 'o9' } }), ctx())
    expect(none.oemAgeDays).toBeNull()
    expect(none.oemBucket).toBe('')
    expect(none.acResolution).toBe('')
  })

  it('takes the store\'s details, trims them, and says Yes / No for Zenatix', () => {
    const f = makeFact(raw(), ctx())
    expect(f).toMatchObject({ store: 'LSR', isStoreAccount: true, city: 'LAKHISARAI', cluster: 'JH1', region: 'R2', priorityList: 'ROS', acTotal: 11, zenatix: 'Yes', acBrand: 'DAIKIN', acAmcBrand: 'DAIKIN', storeType: 'Regular' })
    expect(f.festival).toBe('')
  })

  it('a store without an open date is NSO; so is one that opened less than 9 months ago', () => {
    const st = (open_date: string | null) => ({ ...raw().requester!, store: { ...raw().requester!.store!, open_date } })
    expect(makeFact(raw({ requester: st(null) }), ctx()).storeType).toBe('NSO')
    expect(makeFact(raw({ requester: st('2026-03-01') }), ctx()).storeType).toBe('NSO')
    expect(makeFact(raw({ requester: st('2025-12-01') }), ctx()).storeType).toBe('Regular')
  })

  it('an OEM belongs to AC tickets only: the same store\'s IT ticket has none', () => {
    expect(makeFact(raw(), ctx()).oem).toBe('DAIKAIN OEM - ALL')
    const it = makeFact(raw({ service: { id: 'svc-it', name: 'IT SUPPORT', auto_oem_routing: false } }), ctx())
    expect(it.oem).toBe('')
    expect(it.isAcTicket).toBe(false)
    // an AC ticket from a store with no OEM set up is "(No OEM)"
    const noOem = raw(); noOem.requester!.store!.oem = null
    expect(makeFact(noOem, ctx()).oem).toBe('(No OEM)')
  })

  it('works out AC Not Working % from the store\'s open AC tickets and the AC total, and the red flag above the limit', () => {
    expect(makeFact(raw(), ctx(2))).toMatchObject({ storeAcTickets: 2, redFlag: 'No' })
    expect(makeFact(raw(), ctx(4))).toMatchObject({ storeAcTickets: 4, redFlag: 'Yes' })
    expect(Math.round(makeFact(raw(), ctx(4)).acNotWorkingPct!)).toBe(36)
    // no AC total (store master not filled): no percentage and no flag, not a division by zero
    const unknown = raw(); unknown.requester!.store!.ac_total = null
    expect(makeFact(unknown, ctx(4))).toMatchObject({ acNotWorkingPct: null, redFlag: '' })
  })

  it('a requester who is not a store shows under their own name with no store details', () => {
    const f = makeFact(raw({ requester: { full_name: 'Head Office Person', store: null } }), ctx())
    expect(f).toMatchObject({ store: 'Head Office Person', isStoreAccount: false, cluster: '', storeType: '', acTotal: null, storeAcTickets: 0, redFlag: '' })
  })

  it('has no technician, category or service when the ticket has none', () => {
    const f = makeFact(raw({ assignee: null, category: null, sub_category: null, service: null }), ctx())
    expect(f).toMatchObject({ technician: 'Unassigned', category: '(No category)', subCategory: '(No sub category)', service: '', isAcTicket: false })
  })

  it('age counts to the resolved day for a finished ticket and months/weeks come from the dates', () => {
    const f = makeFact(raw({ resolved_at: '2026-10-08T05:00:00.000Z' }), ctx())
    expect(f.ageDays).toBe(7)
    expect(f).toMatchObject({ openMonth: 'Oct-26', openWeek: 'Week-1', closeMonth: 'Oct-26', closeWeek: 'Week-2' })
  })

  it('reads saved answers: a select\'s option id becomes its name, a date keeps only the day, Server Room AC is recognised', () => {
    expect(answerText('o9', [{ value: 'o9', label: ' 9 ' }])).toBe('9')
    expect(answerText('unknown-id', [{ value: 'o9', label: '9' }])).toBe('unknown-id')
    expect(answerText(['a', 'b'])).toBe('a, b')
    expect(answerText(null)).toBe('')
    expect(answerDay('2026-10-02T00:00:00.000Z')).toBe('2026-10-02')
    expect(answerDay('02/10/2026')).toBeNull()
    expect(isServerRoomAc(' Server  Room AC ')).toBe(true)
    expect(isServerRoomAc('9')).toBe(false)
  })
})
