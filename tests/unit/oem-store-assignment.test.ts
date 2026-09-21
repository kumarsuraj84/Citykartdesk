import { describe, it, expect } from 'vitest'
import { planStoreAssignment } from '@/lib/oems/store-assignment'

const stores = [
  { id: 's1', oem_id: null },
  { id: 's2', oem_id: 'A' },
  { id: 's3', oem_id: 'B' },
  { id: 's4', oem_id: 'A' },
]

describe('planStoreAssignment', () => {
  it('adds unmapped stores', () => {
    expect(planStoreAssignment(stores, ['s1', 's2', 's4'], 'A')).toEqual({ toAssign: ['s1'], toUnassign: [], moved: [] })
  })

  it('removes unticked stores that currently belong to this OEM', () => {
    expect(planStoreAssignment(stores, ['s2'], 'A')).toEqual({ toAssign: [], toUnassign: ['s4'], moved: [] })
  })

  it('moves a store from another OEM and reports where it came from', () => {
    const plan = planStoreAssignment(stores, ['s2', 's4', 's3'], 'A')
    expect(plan.toAssign).toEqual(['s3'])
    expect(plan.moved).toEqual([{ storeId: 's3', fromOemId: 'B' }])
  })

  it('never touches unticked stores that belong to a different OEM', () => {
    const plan = planStoreAssignment(stores, [], 'A')
    expect(plan.toUnassign).toEqual(['s2', 's4'])
    expect(plan.toAssign).toEqual([])
  })

  it('ignores ids that are not real stores', () => {
    expect(planStoreAssignment(stores, ['nope', 's1'], 'A').toAssign).toEqual(['s1'])
  })
})
