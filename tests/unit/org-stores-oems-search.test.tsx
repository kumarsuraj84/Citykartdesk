// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('@/lib/actions/admin/org', () => Object.fromEntries(['createDepartment','updateDepartment','deleteDepartment','importDepartments','createLocation','updateLocation','deleteLocation','importLocations','createCostCenter','updateCostCenter','deleteCostCenter','createJobFunction','updateJobFunction','deleteJobFunction','createDesignation','updateDesignation','deleteDesignation','createStore','updateStore','deleteStore'].map((n) => [n, vi.fn()])))
vi.mock('@/lib/actions/export', () => ({ exportStores: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/components/admin/StoreMasterUploadModal', () => ({ StoreMasterUploadModal: () => null }))
vi.mock('@/components/ui/ImportModal', () => ({ ImportModal: () => null }))
vi.mock('@/components/requests/ExportButton', () => ({ ExportButton: () => null }))

import { OrgStructureClient } from '@/app/(app)/admin/org/OrgStructureClient'
import { matchesStoreSearch } from '@/lib/org/search'

afterEach(() => cleanup())

const store = (id: string, code: string, name: string, o: Record<string, unknown> = {}) => ({
  id, code, name, address: null, city: null, state: null, pincode: null, is_active: true, created_at: '', ac_total: null, ac_brand: null,
  ac_amc_brand: null, ac_amc_vendor: null, zenatix: null, open_date: null, cluster: null, region: null, priority_list: null, festival: null, ...o,
})

const stores = [store('1', 'BNK', 'Bhagalpur Nath', { city: 'Bhagalpur' }), store('2', 'LSR', 'Lakhisarai', { city: 'Lakhisarai' }), store('3', 'SBP', 'Sambalpur', { city: 'Sambalpur' })]
const props = { departments: [], locations: [], costCenters: [], jobFunctions: [], designations: [], allUsers: [], stores } as unknown as React.ComponentProps<typeof OrgStructureClient>

describe('searching stores in Org Structure', () => {
  it('matches a store by code, name or city', () => {
    expect(matchesStoreSearch(stores[0], 'bnk')).toBe(true)
    expect(matchesStoreSearch(stores[0], 'bhagalpur nath')).toBe(true)
    expect(matchesStoreSearch(stores[0], 'lakhisarai')).toBe(false)
    expect(matchesStoreSearch(stores[0], '  ')).toBe(true)
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
})
