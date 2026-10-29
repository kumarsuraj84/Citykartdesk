// "Check my set-up" for a Vendor Program: a plain list of what is done and what is missing. Pure (no database). A program can only be switched on when no blocking item is red.

export type ReadinessItem = { key: string; ok: boolean; blocking: boolean; text: string }

export type ReadinessInput = {
  categories: number
  hasSheet: boolean
  lastStatus: 'ok' | 'error' | null
  lastError: string | null
  activeRows: number
  rowsWithoutMail: number
  unknownStores: number
  unknownFields: string[]
}

export function programReadiness(i: ReadinessInput): { items: ReadinessItem[]; ready: boolean } {
  const items: ReadinessItem[] = [
    {
      key: 'categories', ok: i.categories > 0, blocking: true,
      text: i.categories > 0 ? `${i.categories} categor${i.categories === 1 ? 'y belongs' : 'ies belong'} to this program.` : 'No category is chosen yet. Tickets of a category are only sent to the vendor when it belongs to the program.',
    },
    { key: 'sheet', ok: i.hasSheet, blocking: true, text: i.hasSheet ? 'The Google Sheet link is saved.' : 'The Google Sheet link is not saved yet.' },
    {
      key: 'read', ok: i.hasSheet && i.lastStatus === 'ok', blocking: true,
      text: !i.hasSheet ? 'The sheet has not been read yet.'
        : i.lastStatus === 'ok' ? 'The sheet was read without a stopping problem.'
          : i.lastStatus === 'error' ? `The sheet could not be read: ${i.lastError ?? 'unknown problem'}`
            : 'The sheet has not been read yet. Press "Update from sheet now".',
    },
    { key: 'rows', ok: i.activeRows > 0, blocking: true, text: i.activeRows > 0 ? `${i.activeRows} active row(s) are copied from the sheet.` : 'No active row has been copied from the sheet yet.' },
    {
      key: 'fields', ok: i.unknownFields.length === 0, blocking: true,
      text: i.unknownFields.length === 0 ? 'The mail wording only uses fields that exist.' : `The mail wording uses field(s) that do not exist and would go out empty: ${i.unknownFields.map((f) => `{{${f}}}`).join(', ')}.`,
    },
    {
      key: 'mail', ok: i.rowsWithoutMail === 0, blocking: false,
      text: i.rowsWithoutMail === 0 ? 'Every row has a mail address.' : `${i.rowsWithoutMail} row(s) have no usable mail address. A ticket from those stores stays Open with a note, to be sent by hand.`,
    },
    {
      key: 'stores', ok: i.unknownStores === 0, blocking: false,
      text: i.unknownStores === 0 ? 'Every store in the sheet exists in CK Desk.' : `${i.unknownStores} store(s) in the sheet do not exist in CK Desk yet; nobody can raise a ticket for them until they do.`,
    },
  ]
  return { items, ready: items.every((x) => x.ok || !x.blocking) }
}
