// @vitest-environment jsdom
/**
 * D-02 — the Permission Matrix screen writes real rows (permission_overrides/
 * custom_roles) that nothing in the app reads for an authorization decision
 * (confirmed by runtime UAT: toggling a permission off here had zero effect
 * on what the role could actually do). Until BD-01 (wire it up for real, or
 * remove it — docs/SYSTEM-AUDIT-2026-09-09.md §25.9/Q1) is resolved, editing
 * must stay disabled and the screen must say so clearly, so an admin can't
 * be misled into thinking a toggle here changed access.
 *
 * This is a component-level guard so a future change can't silently
 * re-enable the misleading editable control without this test catching it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PermissionMatrixClient } from '@/app/(app)/admin/roles/PermissionMatrixClient'

afterEach(() => cleanup())

const matrix = [
  { group: 'Requests', label: 'View own requests', user: true, agent: true, manager: true, admin: true, owner: true },
  { group: 'Requests', label: 'Add internal notes', user: false, agent: true, manager: true, admin: true, owner: true },
]

function renderMatrix(canEdit: boolean) {
  return render(
    <PermissionMatrixClient matrix={matrix} overrides={{}} customRoles={[]} canEdit={canEdit} />
  )
}

describe('D-02: Permission Matrix is not interactive while unenforced', () => {
  it('shows the "not enforced" banner even for an admin (canEdit=true)', () => {
    renderMatrix(true)
    expect(screen.getByText(/not enforced/i)).toBeTruthy()
  })

  it('never renders a Save Changes button, even for an admin', () => {
    renderMatrix(true)
    expect(screen.queryByText(/save changes/i)).toBeNull()
  })

  it('never renders an Add Role button, even for an admin', () => {
    renderMatrix(true)
    expect(screen.queryByText(/add role/i)).toBeNull()
  })

  it('renders permission cells as static (no toggle buttons), even for an admin', () => {
    renderMatrix(true)
    // The row label itself must still be visible (read-only display)...
    expect(screen.getByText('View own requests')).toBeTruthy()
    // ...but no button with the toggle title text should exist.
    expect(screen.queryByTitle(/click to grant access/i)).toBeNull()
    expect(screen.queryByTitle(/click to deny access/i)).toBeNull()
  })

  it('does not falsely claim to be RLS/server-enforced in the read-only view', () => {
    renderMatrix(false)
    expect(screen.queryByText(/enforced via RLS/i)).toBeNull()
  })
})
