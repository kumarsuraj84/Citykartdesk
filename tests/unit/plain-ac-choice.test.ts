import { describe, expect, it } from 'vitest'
import { findSelectedMachine, plainAcChoiceLabel } from '@/lib/programs/machines'
import type { ProgramRowRecord } from '@/lib/programs/mail'

// Ticket CKSD-000713 (live, 2 Nov 2026): the AC form's "AC Serial Number" was a fixed list of choices, not linked to the store's AC sheet, so the ticket saved only the id of the chosen
// option and the OEM mail listed every AC of the store. plainAcChoiceLabel reads the number the requester picked from the label of that option.
const OPTIONS = [{ value: 'srv_opt', label: 'Server Room AC' }, { value: 'mu6lahsy_1y', label: '1' }, { value: 'x2', label: '2' }, { value: 'x37', label: '37' }]
const FIELDS = [
  { id: 'c', type: 'phone', label: 'Contact Number' },
  { id: 'serial', type: 'select', label: 'AC Serial Number', options: OPTIONS },
  { id: 'oem', type: 'text', label: 'AC OEM Ticket Number' },
  { id: 'res', type: 'select', label: 'AC resolution', options: [{ value: 'a', label: 'Fixed' }] },
]
const row = (no: string, serial: string) => ({ id: `id-${no}`, machine_no: no, serial } as unknown as ProgramRowRecord)
const STORE = [row('1', 'S1'), row('2', 'S2'), row('3', 'S3'), row('Server Room', 'Server Room')]

describe('the AC choice of a form whose AC box is a plain list', () => {
  it('reads the label of the option that was saved (the id), not the id', () => {
    expect(plainAcChoiceLabel(FIELDS, { serial: 'mu6lahsy_1y' })).toBe('1')
    expect(plainAcChoiceLabel(FIELDS, { serial: 'x2' })).toBe('2')
  })

  it('finds exactly that machine of the store, so only that AC is mailed', () => {
    expect(findSelectedMachine(STORE, plainAcChoiceLabel(FIELDS, { serial: 'mu6lahsy_1y' }))?.machine_no).toBe('1')
    expect(findSelectedMachine(STORE, plainAcChoiceLabel(FIELDS, { serial: 'x2' }))?.machine_no).toBe('2')
  })

  it('"Server Room AC" in the list finds the machine "Server Room" of the sheet', () => {
    expect(plainAcChoiceLabel(FIELDS, { serial: 'srv_opt' })).toBe('Server Room')
    expect(findSelectedMachine(STORE, plainAcChoiceLabel(FIELDS, { serial: 'srv_opt' }))?.machine_no).toBe('Server Room')
  })

  it('a number the store does not have finds nothing (the old behaviour stays: every AC is mailed)', () => {
    expect(findSelectedMachine(STORE, plainAcChoiceLabel(FIELDS, { serial: 'x37' }))).toBeNull()
  })

  it('returns nothing when no AC was chosen, or the form has no such box', () => {
    expect(plainAcChoiceLabel(FIELDS, {})).toBe('')
    expect(plainAcChoiceLabel(FIELDS, { serial: '  ' })).toBe('')
    expect(plainAcChoiceLabel([{ id: 'a', type: 'text', label: 'Subject' }], { a: 'x' })).toBe('')
  })

  it('does not touch the other AC boxes of the form (OEM ticket number, resolution) or a box that is linked to the sheet', () => {
    expect(plainAcChoiceLabel([FIELDS[2], FIELDS[3]], { oem: '12', res: 'a' })).toBe('')
    expect(plainAcChoiceLabel([{ id: 'ac', type: 'select', label: 'AC Serial Number', options_source: 'ac_units', options: OPTIONS }], { ac: 'x2' })).toBe('')
    expect(plainAcChoiceLabel([{ id: 'm', type: 'select', label: 'AC Serial Number', options_source: 'program_machines', options: OPTIONS }], { m: 'x2' })).toBe('')
  })

  it('also reads "AC Number" and "AC No" boxes, and a saved value that is not an option id is taken as it is', () => {
    expect(plainAcChoiceLabel([{ id: 'n', type: 'select', label: 'AC Number', options: OPTIONS }], { n: 'x2' })).toBe('2')
    expect(plainAcChoiceLabel([{ id: 'n', type: 'select', label: 'AC No', options: [] }], { n: '3' })).toBe('3')
    expect(plainAcChoiceLabel([{ id: 'n', type: 'select', label: 'ACME note', options: [] }], { n: '3' })).toBe('')
  })
})
