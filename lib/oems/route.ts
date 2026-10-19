import { storeOemFor, type OemKind, type StoreOemSlots } from './kinds'

export type OemRoute =
  | { action: 'none' }                                                    // nothing asks for an OEM: the ticket is a normal ticket
  | { action: 'send'; kind: OemKind; oemId: string; fromCategory: boolean }
  | { action: 'unmapped'; kind: OemKind }                                 // a category asks for an OEM but the store has none of that type

/**
 * Decides, at ticket creation, whether the ticket goes to an OEM automatically and to which one.
 *  - The category wins: a category with "auto-send to OEM type X" sends to the store's OEM of type X.
 *  - Otherwise a service flagged "auto OEM routing" (the AC Issues service) sends to the store's AC OEM, exactly as before.
 *  - A store with no OEM of the needed type: for the AC service this stays silent as before (the ticket is a normal manual ticket); for a category it is reported
 *    ('unmapped') so the caller can leave an internal note and the gap does not go unnoticed.
 */
export function resolveOemRoute(p: {
  serviceAutoOemRouting: boolean | null | undefined
  categoryOemKind: OemKind | null | undefined
  store: StoreOemSlots | null | undefined
}): OemRoute {
  if (p.categoryOemKind) {
    const oemId = storeOemFor(p.store, p.categoryOemKind)
    return oemId ? { action: 'send', kind: p.categoryOemKind, oemId, fromCategory: true } : { action: 'unmapped', kind: p.categoryOemKind }
  }
  if (p.serviceAutoOemRouting) {
    const oemId = storeOemFor(p.store, 'ac')
    return oemId ? { action: 'send', kind: 'ac', oemId, fromCategory: false } : { action: 'none' }
  }
  return { action: 'none' }
}
