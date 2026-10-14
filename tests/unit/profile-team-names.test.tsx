// @vitest-environment jsdom
// My Profile says who the person reports to, and (for someone who has people reporting to them) lists those people.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'

const { profileMock, reportsMock, managerMock } = vi.hoisted(() => ({ profileMock: vi.fn(), reportsMock: vi.fn(), managerMock: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: (t: string) => { throw new Error('NEXT_REDIRECT:' + t) } }))
vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: profileMock, getDirectReports: reportsMock }))
vi.mock('@/lib/actions/push', () => ({ hasPushSubscription: async () => false }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { email: 'ajay@citykart.test' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: managerMock }) }) }),
  }),
}))
vi.mock('@/app/(app)/profile/ProfileClient', () => ({
  EditableName: ({ initialName }: { initialName: string }) => <span>{initialName}</span>,
  AvatarUpload: () => null, PasswordResetButton: () => null, ChangePasswordForm: () => null, PushNotificationToggle: () => null, PopupSettings: () => null,
}))

import ProfilePage from '@/app/(app)/profile/page'

afterEach(() => cleanup())
beforeEach(() => {
  profileMock.mockReset().mockResolvedValue({ id: 'u1', full_name: 'Arvind Maurya', role: 'agent', is_active: true, created_at: '2026-01-01T00:00:00Z', manager_id: 'm1', team_members: [] })
  reportsMock.mockReset().mockResolvedValue([])
  managerMock.mockReset().mockResolvedValue({ data: { id: 'm1', full_name: 'Ajay Goel', role: 'user' } })
})

describe('My Profile: manager and team', () => {
  it('shows who I report to', async () => {
    render(await ProfilePage())
    expect(screen.getByText('Reports to')).toBeTruthy()
    expect(screen.getByText(/Ajay Goel/)).toBeTruthy()
    expect(screen.queryByText('My Team')).toBeNull()                      // nobody reports to me
  })
  it('shows a dash when I have no manager', async () => {
    profileMock.mockResolvedValue({ id: 'u1', full_name: 'Ajay Goel', role: 'user', is_active: true, created_at: '2026-01-01T00:00:00Z', manager_id: null, team_members: [] })
    render(await ProfilePage())
    expect(screen.getByText('Reports to').parentElement?.textContent).toContain('—')
  })
  it('lists the people who report to me, with their roles', async () => {
    reportsMock.mockResolvedValue([{ id: 'a', full_name: 'Kapil Dev', role: 'agent' }, { id: 'b', full_name: 'Store A', role: 'user' }])
    render(await ProfilePage())
    const list = screen.getByRole('list', { name: 'People who report to you' })
    expect(within(list).getByText('Kapil Dev')).toBeTruthy()
    expect(within(list).getByText('Store A')).toBeTruthy()
    expect(screen.getByText('My Team')).toBeTruthy()
  })
})
