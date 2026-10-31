import { describe, it, expect } from 'vitest'
import { programSampleValues } from '@/lib/programs/sample'
import { PROGRAM_SAMPLE_VALUES, type ProgramRowRecord } from '@/lib/programs/mail'
import { storeFactsFromRow } from '@/lib/stores/details'

// The mail editor's preview and "Send a test to me" are filled from the program's OWN first sheet row, never from another program's example (an AC program once showed RO text).

const acRow: ProgramRowRecord = {
  id: 'r1', store_code: 'RBL', machine_no: '7', serial: 'SE210K03336', vendor: 'UMS CLIMATE', emails: ['x@y.test'], po_emails: [], approver_emails: [],
  extra: { 'AC Type': 'Ductable', 'AC Tonnage': '11 TR', 'AC Brand': 'HITACHI', 'AC Floor': 'FF_First Floor' }, is_active: true, sheet_row: 2,
}
const acProgram = { name: 'AC', row_type: 'machine' as const, details_template: '{{machine_no}} - {{extra_actype}} {{extra_actonnage}}, {{extra_acbrand}}, {{extra_acfloor}}, serial {{serial}}' }

describe('the example values of a program mail', () => {
  it('an AC program shows its own AC row written with its machine wording', () => {
    const v = programSampleValues(acProgram, acRow, { categoryName: 'ADMIN AC ISSUE' })
    expect(v.details).toBe('7 - Ductable 11 TR, HITACHI, FF_First Floor, serial SE210K03336')
    expect(v).toMatchObject({ store_code: 'RBL', machine_no: '7', serial: 'SE210K03336', vendor: 'UMS CLIMATE', category: 'ADMIN AC ISSUE', program: 'AC', extra_actype: 'Ductable' })
  })
  it('nothing of the old RO example is left anywhere', () => {
    const v = programSampleValues(acProgram, acRow, { categoryName: 'ADMIN AC ISSUE' })
    expect(JSON.stringify(v)).not.toMatch(/RO-12345|Aqua Care|purifier|RO Water/i)
    expect(JSON.stringify(PROGRAM_SAMPLE_VALUES)).not.toMatch(/RO-12345|Aqua Care|purifier|RO Water/i)
  })
  it('follows the machine wording as it is typed (empty = the short usual wording)', () => {
    expect(programSampleValues({ ...acProgram, details_template: '' }, acRow).details).toBe('Machine 7, serial SE210K03336, UMS CLIMATE')
    expect(programSampleValues({ ...acProgram, details_template: '{{extra_acbrand}}' }, acRow).details).toBe('HITACHI')
  })
  it('the store details and the address (with its pincode) come from the same row\'s store card', () => {
    const store = storeFactsFromRow({ code: 'RBL', address: 'Hayat Square, Raebareli', pincode: '229001', city: 'RAIBARELI', state: 'UP', region: 'R5', cluster: 'UP5', open_date: '2024-03-12' })
    const v = programSampleValues(acProgram, acRow, { store })
    expect(v).toMatchObject({ store_address: 'Hayat Square, Raebareli - 229001', store_city: 'RAIBARELI', store_state: 'UP', store_region: 'R5', store_cluster: 'UP5', store_open_date: '12 Mar 2024' })
  })
  it('with no row yet the neutral examples are used, with the program\'s own name', () => {
    const v = programSampleValues({ name: 'Genset', row_type: 'store', details_template: null }, null)
    expect(v.program).toBe('Genset')
    expect(v.details).toBe('Machine 1, serial SN-12345, Example Vendor')
    expect(v.store_code).toBe('ALC')
  })
  it('a Genset row is written with the Genset wording', () => {
    const row: ProgramRowRecord = { ...acRow, store_code: 'BTA', machine_no: null, serial: 'CJGS19093340', vendor: null, extra: { 'Genset Brand': 'CUMMINS', 'Genset KVA': '160', 'CPCB Group': 'CPCB-II' } }
    const v = programSampleValues({ name: 'Genset', row_type: 'store', details_template: '{{extra_gensetbrand}} {{extra_gensetkva}} KVA, serial {{serial}}, {{extra_cpcbgroup}}' }, row)
    expect(v.details).toBe('CUMMINS 160 KVA, serial CJGS19093340, CPCB-II')
  })
})
