// The types of OEM a store can have. A store has one slot per type: stores.oem_id is its AC OEM, stores.genset_oem_id is its Genset OEM. The database
// refuses an OEM of the wrong type in a slot (migration 172), so a store can never end up with two AC OEMs.

export const OEM_KINDS = ['ac', 'genset'] as const
export type OemKind = (typeof OEM_KINDS)[number]

export const OEM_KIND_LABEL: Record<OemKind, string> = { ac: 'AC', genset: 'Genset' }

export function isOemKind(value: unknown): value is OemKind {
  return typeof value === 'string' && (OEM_KINDS as readonly string[]).includes(value)
}

/** The column of `stores` that holds the OEM of this type. */
export const STORE_OEM_COLUMN = { ac: 'oem_id', genset: 'genset_oem_id' } as const satisfies Record<OemKind, string>

export type StoreOemSlots = { oem_id: string | null; genset_oem_id: string | null }

/** The OEM a store has in the slot of this type (null = none mapped). */
export function storeOemFor(store: StoreOemSlots | null | undefined, kind: OemKind): string | null {
  if (!store) return null
  return store[STORE_OEM_COLUMN[kind]] ?? null
}

/** The wording of the e-mail to the OEM when the OEM has no template of its own. */
export const OEM_DEFAULT_TEXT: Record<OemKind, { subject: string; body: string }> = {
  ac: {
    subject: 'New AC Issue Ticket — {{ticket_no}}',
    body: 'A new AC issue ticket has been raised.\n\nTicket: {{ticket_no}}\nSubject: {{subject}}\nDescription: {{description}}\n\nRequester: {{requester_name}} ({{requester_email}}, {{requester_phone}})\nStore Address: {{store_address}}',
  },
  genset: {
    subject: 'New Genset Issue Ticket — {{ticket_no}}',
    body: 'A new Genset issue ticket has been raised.\n\nTicket: {{ticket_no}}\nSubject: {{subject}}\nDescription: {{description}}\n\nRequester: {{requester_name}} ({{requester_email}}, {{requester_phone}})\nStore Address: {{store_address}}',
  },
}
