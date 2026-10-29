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
  it('two rows with the same machine number are one choice, and a choice is found again whatever its case', () => {
    const rows = [row({ id: 'a', machine_no: 'Server Room' }), row({ id: 'b', machine_no: 'server room' }), row({ id: 'c', machine_no: '5', serial: 'XY9' })]
    expect(machineOptions(rows).map((o) => o.value)).toEqual(['Server Room', '5'])
    expect(findSelectedMachine(rows, 'SERVER ROOM')?.id).toBe('a')
    expect(findSelectedMachine(rows, 'xy9')?.id).toBe('c')      // by serial too
    expect(findSelectedMachine(rows, 'nope')).toBeNull()
    expect(findSelectedMachine(rows, '')).toBeNull()
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
