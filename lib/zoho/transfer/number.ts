/**
 * The CK Desk ticket number of a moved Zoho ticket: `ZOHO-` + the Zoho ticket number EXACTLY as Zoho has it.
 * Zeros are kept if Zoho has them and none are ever added. (The Zoho copy stores the number as a whole number, so in practice it has none.)
 */
export const ZOHO_PREFIX = 'ZOHO-'

export function zohoRequestNo(zohoNumber: number | string): string | null {
  const t = String(zohoNumber ?? '').trim()
  if (!/^\d{1,18}$/.test(t)) return null
  return `${ZOHO_PREFIX}${t}`
}

/** True for a number made by this transfer (so the number rule in the database and the screens can recognise it). */
export const isZohoRequestNo = (requestNo: string | null | undefined) => /^ZOHO-\d{1,18}$/.test(String(requestNo ?? ''))
