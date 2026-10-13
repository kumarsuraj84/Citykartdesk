// Who an inbound e-mail really came from. Audit finding D-057: the sender used to be pulled out of the parsed "From" TEXT with a regular
// expression (the first <...> in it), so a message whose display NAME contained another address
//   From: "x <manager@citykart.org>" <someone@attacker.example>
// was attributed to manager@citykart.org. The address is now read from the parsed header's structured field, and a message that does not
// have exactly one plain sender address is not trusted at all.

type ParsedAddress = { address?: string; name?: string; group?: unknown }
type ParsedFrom = { value?: ParsedAddress[] } | undefined | null

const PLAIN_ADDRESS = /^[^\s@<>"',;()[\]\\]+@[^\s@<>"',;()[\]\\]+\.[^\s@<>"',;()[\]\\]+$/

/** The one sender address (lower-case), or null when the header is missing, has several senders, a group, or no valid address. */
export function senderAddress(from: ParsedFrom): string | null {
  const list = from?.value
  if (!Array.isArray(list) || list.length !== 1) return null
  const entry = list[0]
  if (!entry || entry.group) return null
  const address = (entry.address ?? '').trim().toLowerCase()
  return PLAIN_ADDRESS.test(address) ? address : null
}
