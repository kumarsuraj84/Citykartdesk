import { describe, it, expect } from 'vitest'
import { findSelectedMachine, machineOptions, machineValueOf } from '@/lib/programs/machines'
import { withProgramMachineOptions } from '@/components/forms/DynamicForm'

const row = (o: Record<string, unknown>) => ({ id: 'r1', store_code: 'ALC', machine_no: '3', serial: 'W250146004', vendor: null, emails: [], po_emails: [], approver_emails: [], extra: { 'AC Floor': 'GF', 'AC Brand': 'VOLTAS' }, is_active: true, sheet_row: 2, ...o }) as never

describe('the machine list of a program with one row per machine', () => {
  it('a machine is chosen by its number, else its serial, else its row; the label uses the program\'s row wording', () => {
    expect(machineValueOf(row({}))).toBe('3')
    expect(machineValueOf(row({ machine_no: null }))).toBe('W250146004')
    expect(machineValueOf(row({ machine_no: null, serial: null }))).toBe('r1')
    expect(machineOptions([row({})])).toEqual([{ value: '3', label: '3' }])
  })
  it('two rows with the same machine number are BOTH choices (the second shows its serial), and a choice is found again whatever its case', () => {
    const rows = [row({ id: 'a', machine_no: 'Server Room', serial: 'S-A' }), row({ id: 'b', machine_no: 'server room', serial: 'S-B' }), row({ id: 'c', machine_no: '5', serial: 'XY9' })]
    expect(machineOptions(rows).map((o) => o.value)).toEqual(['Server Room', 'server room (S-B)', '5'])
    expect(findSelectedMachine(rows, 'SERVER ROOM')?.id).toBe('a')   // the plain number is the first row, so a choice saved before still points to it
    expect(findSelectedMachine(rows, 'server room (s-b)')?.id).toBe('b')   // the second machine can be chosen, so its addresses are reachable
    expect(machineValueOf(findSelectedMachine(rows, 'server room (S-B)')!)).toBe('server room (S-B)')   // and the value kept with the ticket points back to exactly that row
    expect(findSelectedMachine(rows, 'xy9')?.id).toBe('c')      // by serial too
    expect(findSelectedMachine(rows, 'nope')).toBeNull()
    expect(findSelectedMachine(rows, '')).toBeNull()
  })
  it('a repeated number without a serial is told apart by its sheet row', () => {
    const rows = [row({ id: 'a', machine_no: '7', serial: null, sheet_row: 2 }), row({ id: 'b', machine_no: '7', serial: null, sheet_row: 9 })]
    expect(machineOptions(rows).map((o) => o.value)).toEqual(['7', '7 (row 9)'])
    expect(findSelectedMachine(rows, '7 (row 9)')?.id).toBe('b')
  })
})

describe('the machine box of the ticket form', () => {
  const sections = [{ id: 's', title: 'T', order: 1, fields: [
    { id: 'subject', type: 'text', label: 'Subject', required: true, order: 1 },
    { id: 'machine', type: 'select', label: 'Machine', required: false, order: 2, options_source: 'program_machines', options: [] },
  ] }] as never
  const fieldsOf = (s: ReturnType<typeof withProgramMachineOptions>) => s.flatMap((x) => x.fields)
  it('shows the store\'s machines for a category of a machine program and makes the box compulsory', () => {
    const f = fieldsOf(withProgramMachineOptions(sections, { cat1: [{ value: '1', label: 'AC 1' }, { value: '2', label: 'AC 2' }] }, 'cat1')).find((x) => x.id === 'machine')!
    expect(f.options?.map((o) => o.value)).toEqual(['1', '2'])
    expect(f.required).toBe(true)
  })
  it('a store with no machine sees the box with a hint and no compulsion; any other category does not see the box at all', () => {
    const none = fieldsOf(withProgramMachineOptions(sections, { cat1: [] }, 'cat1')).find((x) => x.id === 'machine')!
    expect(none.required).toBe(false)
    expect(none.help_text).toMatch(/No machine is listed/)
    expect(fieldsOf(withProgramMachineOptions(sections, { cat1: [{ value: '1', label: 'AC 1' }] }, 'other')).map((x) => x.id)).toEqual(['subject'])
    expect(fieldsOf(withProgramMachineOptions(sections, { cat1: [] }, null)).map((x) => x.id)).toEqual(['subject'])
  })
  it('a user with no store (nothing loaded) keeps the form as it is', () => {
    expect(fieldsOf(withProgramMachineOptions(sections, undefined, 'cat1')).map((x) => x.id)).toEqual(['subject', 'machine'])
  })
})
