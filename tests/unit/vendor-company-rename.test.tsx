// @vitest-environment jsdom
// An administrator can rename a vendor company (people, tickets and history stay with it), and the Vendors page has the Rename button for it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'

let role = 'admin'
let existing: { id: string; name: string } | null = { id: 'c1', name: 'Old Name' }
let updateError: { code?: string } | null = null
const updates: Record<string, unknown>[] = []
const audits: Record<string, unknown>[] = []

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: async () => ({ id: 'a', role, org_id: 'org' }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn() }))
vi.mock('@/lib/email/auth-mail', () => ({ emailInvitation: vi.fn() }))
vi.mock('@/lib/email/org-domains', () => ({ organisationMailDomains: vi.fn(), isOrganisationAddress: vi.fn() }))
vi.mock('@/lib/permissions/policies', () => ({ loadPolicies: vi.fn() }))
vi.mock('@/lib/syslog/audit', () => ({ recordAudit: async (e: Record<string, unknown>) => { audits.push(e) } }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      let isUpdate = false
      const q: Record<string, unknown> = {
        select: () => q,
        update: (values: Record<string, unknown>) => { isUpdate = true; updates.push(values); return q },
        eq: () => q,
        maybeSingle: async () => ({ data: existing }),
        then: (resolve: (v: unknown) => void) => resolve({ error: isUpdate ? updateError : null }),
      }
      return q
    },
  }),
}))

import { renameVendorCompany } from '@/lib/actions/admin/vendors'
import { VendorsClient } from '@/app/(app)/admin/vendors/VendorsClient'

afterEach(() => cleanup())
beforeEach(() => { role = 'admin'; existing = { id: 'c1', name: 'Old Name' }; updateError = null; updates.length = 0; audits.length = 0 })

describe('renameVendorCompany', () => {
  it('renames, trims the spaces and writes one audit line with the old and the new name', async () => {
    expect(await renameVendorCompany('c1', '  New   Name ')).toEqual({})
    expect(updates).toEqual([{ name: 'New Name' }])
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: 'vendor.company_renamed', before: { name: 'Old Name' }, after: { name: 'New Name' } })
  })
  it('does nothing (and logs nothing) when the name is the same', async () => {
    expect(await renameVendorCompany('c1', 'Old Name')).toEqual({})
    expect(updates).toHaveLength(0)
    expect(audits).toHaveLength(0)
  })
  it('refuses a name that is too short or too long', async () => {
    expect((await renameVendorCompany('c1', 'A')).error).toMatch(/2 to 120/)
    expect((await renameVendorCompany('c1', 'x'.repeat(121))).error).toMatch(/2 to 120/)
    expect(updates).toHaveLength(0)
  })
  it('says so when the company is not found (another organisation or a wrong id)', async () => {
    existing = null
    expect((await renameVendorCompany('nope', 'New Name')).error).toBe('Vendor company not found.')
    expect(updates).toHaveLength(0)
  })
  it('says so when another company already has that name', async () => {
    updateError = { code: '23505' }
    expect((await renameVendorCompany('c1', 'Taken')).error).toBe('A vendor company with this name already exists.')
    expect(audits).toHaveLength(0)
  })
  it('is for administrators and the platform owner only', async () => {
    role = 'agent'
    expect((await renameVendorCompany('c1', 'New Name')).error).toBe('Unauthorized.')
    expect(updates).toHaveLength(0)
  })
})

describe('Vendors page: Rename button', () => {
  const companies = [{ id: 'c1', name: 'Old Name', is_active: true, technicians: 2, managers: 1 }]
  it('opens a name box with the current name, saves the new one, and can be cancelled', async () => {
    render(<VendorsClient companies={companies} people={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const box = screen.getByLabelText('New name of Old Name') as HTMLInputElement
    expect(box.value).toBe('Old Name')
    fireEvent.change(box, { target: { value: 'New Name' } })
    fireEvent.click(screen.getByRole('button', { name: /Save name/ }))
    await waitFor(() => expect(updates).toEqual([{ name: 'New Name' }]))
    await waitFor(() => expect(screen.queryByLabelText('New name of Old Name')).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('New name of Old Name')).toBeNull()
  })
  it('keeps Save name off until the name has two letters', () => {
    render(<VendorsClient companies={companies} people={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('New name of Old Name'), { target: { value: 'A' } })
    expect((screen.getByRole('button', { name: /Save name/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
