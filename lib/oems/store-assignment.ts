export interface StoreOemLink {
  id: string
  oem_id: string | null
}

export interface StoreAssignmentPlan {
  /** Stores to point at this OEM (includes ones that move over from another OEM). */
  toAssign: string[]
  /** Stores currently on this OEM that were unticked — they become unmapped. */
  toUnassign: string[]
  /** The subset of toAssign that currently belong to a DIFFERENT OEM. */
  moved: { storeId: string; fromOemId: string }[]
}

/**
 * Works out what saving the "Assign stores" list for one OEM must change.
 * A store has exactly one OEM, so ticking a store that sits under another OEM moves it.
 * Ids that are not in `stores` are ignored (they cannot be assigned).
 */
export function planStoreAssignment(stores: StoreOemLink[], selectedIds: Iterable<string>, oemId: string): StoreAssignmentPlan {
  const selected = new Set(selectedIds)
  const toAssign: string[] = []
  const toUnassign: string[] = []
  const moved: StoreAssignmentPlan['moved'] = []

  for (const s of stores) {
    const isSelected = selected.has(s.id)
    if (isSelected && s.oem_id !== oemId) {
      toAssign.push(s.id)
      if (s.oem_id) moved.push({ storeId: s.id, fromOemId: s.oem_id })
    } else if (!isSelected && s.oem_id === oemId) {
      toUnassign.push(s.id)
    }
  }
  return { toAssign, toUnassign, moved }
}
