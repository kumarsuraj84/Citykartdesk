// @vitest-environment jsdom
/**
 * The ticket sidebar's Category / Sub Category rows (21 Nov 2026): a technician who had not picked a ticket up yet saw "Category" but no "Sub Category", although the ticket had one.
 * The list of choices is only loaded for the person who may work on the ticket, and the row used to depend on that list. It now shows whenever the ticket has a sub category.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/actions/requests', () => ({
  updateRequestStatus: vi.fn(), assignRequest: vi.fn(), addCollaborator: vi.fn(), removeCollaborator: vi.fn(),
  searchOrgMembers: vi.fn(), searchAgentTierMembers: vi.fn(), updateRequestCategory: vi.fn(async () => ({})),
}))
vi.mock('@/lib/actions/attachments', () => ({ uploadAttachment: vi.fn() }))

import { CategoryRow } from '@/components/requests/RequestSidebarPanel'
import type { AllowedSubCategory } from '@/types'

afterEach(() => cleanup())

const sc = (id: string, name: string, category_id: string, category_name: string) => ({ id, name, category_id, category_name }) as unknown as AllowedSubCategory
const CHOICES = [
  sc('s1', 'CARRY BAG UPDATION', 'c1', 'GENISYS SUPPORT'),
  sc('s2', 'BARCODE ISSUE', 'c1', 'GENISYS SUPPORT'),
  sc('s3', 'PRINTER ISSUE', 'c2', 'HARDWARE'),
]
const row = (over: Partial<Parameters<typeof CategoryRow>[0]> = {}) =>
  render(<CategoryRow requestId="r1" categoryName="GENISYS SUPPORT" subCategoryId="s1" subCategoryName="CARRY BAG UPDATION" isAgent={false} allowedSubCategories={[]} {...over} />)

describe('Category / Sub Category rows in the ticket sidebar', () => {
  it('a technician who may not work on the ticket yet (no list of choices) still sees the ticket\'s Sub Category, read-only', () => {
    row()
    expect(screen.getByText('Category')).toBeTruthy()
    expect(screen.getByText('GENISYS SUPPORT')).toBeTruthy()
    expect(screen.getByText('Sub Category')).toBeTruthy()
    expect(screen.getByText('CARRY BAG UPDATION')).toBeTruthy()
    // nothing to open: no drop-down arrow and no search box appears when it is clicked
    fireEvent.click(screen.getByText('CARRY BAG UPDATION'))
    fireEvent.click(screen.getByText('GENISYS SUPPORT'))
    expect(screen.queryByLabelText('Search sub category')).toBeNull()
    expect(screen.queryByLabelText('Search category')).toBeNull()
  })

  it('a requester sees both rows too, read-only', () => {
    row({ isAgent: false, allowedSubCategories: [] })
    expect(screen.getByText('Sub Category')).toBeTruthy()
  })

  it('a ticket with no sub category and nothing to choose from shows no empty Sub Category row', () => {
    row({ subCategoryId: null, subCategoryName: null })
    expect(screen.queryByText('Sub Category')).toBeNull()
  })

  it('the technician who may work on the ticket sees both rows and can open both lists', () => {
    row({ isAgent: true, allowedSubCategories: CHOICES })
    expect(screen.getByText('CARRY BAG UPDATION')).toBeTruthy()
    fireEvent.click(screen.getByText('GENISYS SUPPORT'))
    expect(screen.getByLabelText('Search category')).toBeTruthy()
    expect(screen.getByText('HARDWARE')).toBeTruthy()
  })

  it('choosing another category offers that category\'s sub categories next', () => {
    row({ isAgent: true, allowedSubCategories: CHOICES })
    fireEvent.click(screen.getByText('GENISYS SUPPORT'))
    fireEvent.click(screen.getByText('HARDWARE'))
    expect(screen.getByLabelText('Search sub category')).toBeTruthy()
    expect(screen.getByText('PRINTER ISSUE')).toBeTruthy()
    expect(screen.queryByText('BARCODE ISSUE')).toBeNull()
  })

  it('a sub category that is no longer on the offered list is still shown', () => {
    row({ isAgent: true, subCategoryId: 'old', subCategoryName: 'OLD SUB CATEGORY', allowedSubCategories: CHOICES })
    expect(screen.getByText('Sub Category')).toBeTruthy()
    expect(screen.getByText('OLD SUB CATEGORY')).toBeTruthy()
  })

  it('a ticket that has a category but no sub category gets the Sub Category row as soon as a category is chosen', () => {
    row({ isAgent: true, subCategoryId: null, subCategoryName: null, allowedSubCategories: CHOICES })
    expect(screen.queryByText('Sub Category')).toBeNull()
    fireEvent.click(screen.getByText('GENISYS SUPPORT'))
    fireEvent.click(screen.getByText('GENISYS SUPPORT', { selector: 'button' }))
    expect(screen.getByText('Sub Category')).toBeTruthy()
    expect(screen.getByText('Select…')).toBeTruthy()
  })
})
