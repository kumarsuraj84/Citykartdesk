import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { acOptionsFor, findSelectedUnit } from '@/lib/masters/resolve'
import type { AcUnitRecord } from '@/lib/masters/resolve'

// The store picks its AC by the CKDESK number only. Floor, type, tonnage and brand stay in the database (and in the ticket's saved details) for the OEM mail,
// the reports and the analysis, but they are not shown in the list the requester chooses from, so nobody is confused by them.
const unit = (no: string, extra: Partial<AcUnitRecord> = {}): AcUnitRecord => ({
  id: `id-${no}-${extra.serial ?? ''}`, store_code: 'COB', ckdesk_no: no, serial: `SER-${no}`, floor: 'FF_First Floor', ac_type: 'Ductable', tonnage: '5.5 TR', brand: 'BLUE STAR',
  amc_vendor: 'STAR COOLING CENTRE', amc_brand: null, is_active: true, emails: [], po_emails: [], approver_emails: [], sheet_row: 10, ...extra,
} as unknown as AcUnitRecord)

describe('the AC list the requester sees', () => {
  it('shows only the CKDESK number, nothing about floor, type, tonnage, brand or serial', () => {
    const opts = acOptionsFor([unit('1'), unit('2'), unit('Server Room')])
    expect(opts.map((o) => o.label)).toEqual(['1', '2', 'Server Room'])
    for (const o of opts) expect(o.label).not.toMatch(/Floor|Ductable|TR|BLUE|SER-/i)
  })
  it('the saved value is still the CKDESK number, so the ticket, the OEM mail and the reports find the unit', () => {
    const units = [unit('1'), unit('2')]
    expect(acOptionsFor(units).map((o) => o.value)).toEqual(['1', '2'])
    expect(findSelectedUnit(units, '2')?.ckdesk_no).toBe('2')
  })
  it('two units of one store with the same number are still told apart (the serial is added)', () => {
    const opts = acOptionsFor([unit('1', { serial: 'AAA', sheet_row: 5 }), unit('1', { serial: 'BBB', sheet_row: 6 })])
    expect(opts.map((o) => o.label)).toEqual(['1 (AAA)', '1 (BBB)'])
  })
})
