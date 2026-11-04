import { describe, it, expect } from 'vitest'
import { barStoreApprovers, showApprovalsMenu, storeLinkedAmong, STORE_APPROVER_MESSAGE } from '@/lib/approvals/store-users'

// A store user (linked to a store) is never an approver; a head-office requester (no store link) can be. The Approvals menu is hidden for a store user.

const fakeProfiles = (rows: { id: string; store_id: string | null }[], fail = false) => ({
  from: () => ({ select: () => ({ in: (_c: string, ids: string[]) => Promise.resolve(fail ? { data: null, error: { message: 'down' } } : { data: rows.filter((r) => ids.includes(r.id)), error: null }) }) }),
})
const people = [
  { id: 'store-a', store_id: 'S1' },
  { id: 'store-b', store_id: 'S2' },
  { id: 'ho-requester', store_id: null },   // a head-office requester: allowed
  { id: 'tech', store_id: null },
]

describe('store users are never approvers', () => {
  it('finds the store-linked ones among the people chosen', async () => {
    expect(await storeLinkedAmong(fakeProfiles(people), ['tech', 'store-a', 'ho-requester', 'store-b'])).toEqual(['store-a', 'store-b'])
    expect(await storeLinkedAmong(fakeProfiles(people), ['tech', 'ho-requester'])).toEqual([])
    expect(await storeLinkedAmong(fakeProfiles(people), [])).toEqual([])
  })

  it('refuses when any of them is a store user, and lets a head-office requester through', async () => {
    expect(await barStoreApprovers(fakeProfiles(people), ['tech', 'store-a'])).toBe(STORE_APPROVER_MESSAGE)
    expect(await barStoreApprovers(fakeProfiles(people), ['ho-requester', 'tech'])).toBeNull()
  })

  it('refuses (never lets a store user slip through) when the check itself cannot be done', async () => {
    const r = await barStoreApprovers(fakeProfiles(people, true), ['store-a'])
    expect(r).toMatch(/could not be checked/)
  })
})

describe('the Approvals menu', () => {
  it('is hidden for a store user, shown to everyone else', () => {
    expect(showApprovalsMenu({ moduleOn: true, storeLinked: true, waiting: 0 })).toBe(false)
    expect(showApprovalsMenu({ moduleOn: true, storeLinked: false, waiting: 0 })).toBe(true)   // head office, technician, manager, admin
  })
  it('is never hidden from someone an approval is waiting for', () => {
    expect(showApprovalsMenu({ moduleOn: true, storeLinked: true, waiting: 2 })).toBe(true)
  })
  it('stays off when the Approvals module is off', () => {
    expect(showApprovalsMenu({ moduleOn: false, storeLinked: false, waiting: 5 })).toBe(false)
  })
})
