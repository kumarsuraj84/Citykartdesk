// Mail server addresses typed into Platform Settings (D-026). The server connects to whatever is entered here, so an address that points back
// at the server itself (or at the cloud metadata service) must not be accepted. Internal mail relays on private network addresses are
// legitimate and stay allowed: only loopback, "this host", link-local and metadata addresses are refused.

const LOOPBACK_NAME = /^(localhost|localhost\.localdomain|ip6-localhost|ip6-loopback)$/i
const METADATA_NAME = /^(metadata|metadata\.google\.internal|instance-data)$/i

/** Returns a message to show the administrator, or null when the address is acceptable. Expects a trimmed host (no port, no scheme). */
export function mailHostProblem(host: string): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '')
  if (!h || h.length > 253 || !/^[a-z0-9.-]+$/.test(h)) return 'Enter a valid mail server address, e.g. smtp.gmail.com.'
  if (LOOPBACK_NAME.test(h) || h.endsWith('.localhost')) return 'The mail server cannot be this computer (localhost). Enter the real mail server address.'
  if (METADATA_NAME.test(h)) return 'That address is not a mail server.'

  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (ip) {
    const o = ip.slice(1).map(Number)
    if (o.some((n) => n > 255)) return 'Enter a valid mail server address, e.g. smtp.gmail.com.'
    if (o[0] === 127 || o[0] === 0) return 'The mail server cannot be this computer (127.x / 0.x). Enter the real mail server address.'
    if (o[0] === 169 && o[1] === 254) return 'That address is reserved for the network itself (169.254.x.x) and cannot be a mail server.'
    if (o[0] >= 224) return 'That address cannot be a mail server.'
  }
  // a name made only of digits and dots must be a plain dotted address: 127.1 and 0177.0.0.1 are read as 127.0.0.1 by the resolver (VAPT, earlier D-026)
  if (/^[0-9.]+$/.test(h) && !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(h)) return 'Enter the mail server by name or as a dotted address, e.g. smtp.gmail.com.'
  // numeric shortcuts that some resolvers read as an address (e.g. 2130706433 or 0x7f000001 for 127.0.0.1)
  if (/^\d+$/.test(h) || /(^|\.)0x[0-9a-f]+(\.|$)/i.test(h)) return 'Enter the mail server by name or as a dotted address, e.g. smtp.gmail.com.'
  return null
}
