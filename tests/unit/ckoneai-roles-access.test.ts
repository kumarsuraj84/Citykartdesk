import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/queries/profiles', () => ({ getCurrentProfile: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { rolesFor, mayUseAssistant, isManagerTier, isHierarchyManager, isOrgWide } from '@/lib/ckoneai/roles'
import { decideAccess } from '@/lib/ckoneai/access'
import { readCkoneaiConfig } from '@/lib/ckoneai/config'
import type { ProfileWithTeams } from '@/types'

const person = (over: Record<string, unknown> = {}) => ({ id: '11111111-2222-4333-8444-555555555555', role: 'user', vendor_company_id: null, vendor_role: null, ...over }) as unknown as ProfileWithTeams

describe('which roles CKOneAI is told', () => {
  it('a plain user is only a requester', () => {
    expect(rolesFor(person(), false)).toEqual(['requester'])
  })
  it('an agent is also a technician, not an approver', () => {
    expect(rolesFor(person({ role: 'agent' }), false)).toEqual(['requester', 'technician'])
  })
  it('a manager is technician, approver and manager (own hierarchy)', () => {
    expect(rolesFor(person({ role: 'manager' }), false)).toEqual(['approver', 'manager', 'requester', 'technician'])
  })
  it('an admin or platform owner is technician, approver and orgwide (whole organisation)', () => {
    for (const role of ['admin', 'platform_owner']) expect(rolesFor(person({ role }), false), role).toEqual(['approver', 'orgwide', 'requester', 'technician'])
  })
  it('anybody named on an approval step is an approver', () => {
    expect(rolesFor(person(), true)).toEqual(['approver', 'requester'])
    expect(rolesFor(person({ role: 'agent' }), true)).toEqual(['approver', 'requester', 'technician'])
  })
  it('the manager tier covers manager, admin and platform owner; a plain user, agent or named approver never gets manager or orgwide', () => {
    expect(isManagerTier(person({ role: 'manager' }))).toBe(true)
    expect(isManagerTier(person({ role: 'agent' }))).toBe(false)
    for (const role of ['user', 'agent']) for (const named of [false, true]) { const r = rolesFor(person({ role }), named); expect(r).not.toContain('manager'); expect(r).not.toContain('orgwide') }
    expect(rolesFor(person({ role: 'manager' }), false)).not.toContain('orgwide')    // a manager is never org-wide
    expect(rolesFor(person({ role: 'admin' }), false)).not.toContain('manager')      // an admin is org-wide, not a hierarchy manager
  })
  it('manager (own hierarchy) and orgwide (whole organisation) are told apart', () => {
    expect([isHierarchyManager(person({ role: 'manager' })), isOrgWide(person({ role: 'manager' }))]).toEqual([true, false])
    for (const role of ['admin', 'platform_owner']) expect([isHierarchyManager(person({ role })), isOrgWide(person({ role }))], role).toEqual([false, true])
    for (const role of ['user', 'agent']) expect([isHierarchyManager(person({ role })), isOrgWide(person({ role }))], role).toEqual([false, false])
  })
  it('is always sorted', () => {
    const r = rolesFor(person({ role: 'admin' }), true)
    expect(r).toEqual([...r].sort())
  })
})

describe('who may use the assistant', () => {
  const on = readCkoneaiConfig({ CKONEAI_ENABLED: '1', CKONEAI_BASE_URL: 'http://10.0.0.82:8100', CKONEAI_BRIDGE_SECRET_CKDESK: 'x'.repeat(40), CKONEAI_PILOT_USER_IDS: '11111111-2222-4333-8444-555555555555' })
  const off = readCkoneaiConfig({})

  it('switched off: 503 for everybody, with the reason kept for the log', () => {
    expect(decideAccess(off, person())).toMatchObject({ ok: false, status: 503 })
  })
  it('no signed-in person: 401', () => {
    expect(decideAccess(on, null)).toMatchObject({ ok: false, status: 401 })
  })
  it('a vendor (OEM engineer) login: 403, even on the pilot list', () => {
    const v = person({ vendor_company_id: 'c1', vendor_role: 'technician' })
    expect(mayUseAssistant(v)).toBe(false)
    expect(decideAccess(on, v)).toMatchObject({ ok: false, status: 403 })
  })
  it('a person who is not on the pilot list: 403', () => {
    expect(decideAccess(on, person({ id: '99999999-2222-4333-8444-555555555555' }))).toMatchObject({ ok: false, status: 403 })
  })
  it('a pilot person is let in', () => {
    expect(decideAccess(on, person())).toMatchObject({ ok: true })
  })
})
