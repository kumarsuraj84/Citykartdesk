// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('@/lib/actions/admin/org', () => Object.fromEntries(['createDepartment','updateDepartment','deleteDepartment','importDepartments','createLocation','updateLocation','deleteLocation','importLocations','createCostCenter','updateCostCenter','deleteCostCenter','createJobFunction','updateJobFunction','deleteJobFunction','createDesignation','updateDesignation','deleteDesignation','createStore','updateStore','deleteStore'].map((n) => [n, vi.fn()])))
vi.mock('@/lib/actions/admin/oems', () => ({ createOem: vi.fn(), updateOem: vi.fn(), deleteOem: vi.fn(), setOemStores: vi.fn() }))
vi.mock('@/lib/actions/export', () => ({ exportStores: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/admin/StoreMasterUploadModal', () => ({ StoreMasterUploadModal: () => null }))
vi.mock('@/components/ui/ImportModal', () => ({ ImportModal: () => null }))
vi.mock('@/components/requests/ExportButton', () => ({ ExportButton: () => null }))

import { OrgStructureClient } from '@/app/(app)/admin/org/OrgStructureClient'
import { matchesStoreSearch, matchesOemSearch } from '@/lib/org/search'

afterEach(() => cleanup())

const store = (id: string, code: string, name: string, o: Record<string, unknown> = {}) => ({
  id, code, name, address: null, city: null, state: null, pincode: null, oem_id: null, oem_name: null, is_active: true, created_at: '', ac_total: null, ac_brand: null,
  ac_amc_brand: null, ac_amc_vendor: null, zenatix: null, open_date: null, cluster: null, region: null, priority_list: null, festival: null, ...o,
})
const oem = (id: string, name: string, emails: string[]) => ({ id, name, emails, email_subject_template: null, email_body_template: null, is_active: true, created_at: '' })

const stores = [store('1', 'BNK', 'Bhagalpur Nath', { city: 'Bhagalpur', oem_name: 'HITACHI OEM' }), store('2', 'LSR', 'Lakhisarai', { city: 'Lakhisarai', oem_name: 'DAIKIN OEM' }), store('3', 'SBP', 'Sambalpur', { city: 'Sambalpur' })]
const oems = [oem('o1', 'HITACHI OEM', ['service@hitachi.test']), oem('o2', 'DAIKIN OEM', ['help@daikin.test'])]
const props = { departments: [], locations: [], costCenters: [], jobFunctions: [], designations: [], allUsers: [], oems, stores } as never

describe('searching stores and OEMs in Org Structure', () => {
  it('matches a store by code, name, city or OEM, and an OEM by name or e-mail', () => {
    expect(matchesStoreSearch(stores[0], 'bnk')).toBe(true)
    expect(matchesStoreSearch(stores[0], 'bhagalpur hitachi')).toBe(true)
    expect(matchesStoreSearch(stores[0], 'daikin')).toBe(false)
    expect(matchesStoreSearch(stores[0], '  ')).toBe(true)
    expect(matchesOemSearch(oems[1], 'DAIKIN')).toBe(true)
    expect(matchesOemSearch(oems[1], 'help@')).toBe(true)
    expect(matchesOemSearch(oems[1], 'hitachi')).toBe(false)
  })

  it('the Stores tab narrows as you type', () => {
    render(<OrgStructureClient {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /^Stores/ }))
    fireEvent.change(screen.getByLabelText('Search stores'), { target: { value: 'lakhi' } })
    expect(screen.getByText('LSR')).toBeTruthy()
    expect(screen.queryByText('BNK')).toBeNull()
    expect(screen.queryByText('SBP')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search stores'), { target: { value: 'nothing like this' } })
    expect(screen.getByText(/No store matches/)).toBeTruthy()
  })

  it('the OEMs tab narrows as you type', () => {
    render(<OrgStructureClient {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /^OEMs/ }))
    fireEvent.change(screen.getByLabelText('Search OEMs'), { target: { value: 'daikin' } })
    expect(screen.getAllByText('DAIKIN OEM').length).toBeGreaterThan(0)
    expect(screen.queryByText('HITACHI OEM')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search OEMs'), { target: { value: 'zzz' } })
    expect(screen.getByText(/No OEM matches/)).toBeTruthy()
  })
})
