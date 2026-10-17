// A browser push subscription carries the address our server will POST to when it sends a notification. A person could submit any address
// there, making the server call internal services (audit D-025). Real push services are public https hosts, so the address must be https, must
// not be an IP literal, and must not be a local or internal name.

/**
 * The push services browsers really use. A subscription address must belong to one of them (VAPT-036 / D-025): even a public https address of anybody else
 * would make the server post to a stranger's site. Extra hosts for a service the company runs can be added with PUSH_ENDPOINT_EXTRA_HOSTS (comma list of
 * host suffixes); nothing is added by default.
 */
const PUSH_SERVICE_SUFFIXES = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'notify.windows.com', 'push.apple.com', 'web.push.apple.com']

function allowedSuffixes(): string[] {
  const extra = (process.env.PUSH_ENDPOINT_EXTRA_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase().replace(/^[.]/, '')).filter(Boolean)
  return [...PUSH_SERVICE_SUFFIXES, ...extra]
}

export function isAcceptablePushEndpoint(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return false
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  if (u.port && u.port !== '443') return false
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (!host.includes('.')) return false // "localhost", "intranet", ...
  if (host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^[0-9a-f:]+$/.test(host)) return false // IP literals
  if (/^\d+$/.test(host.split('.').pop() ?? '')) return false // numeric last label: an address written in another form
  if (/(^|\.)(localhost|local|internal|intranet|lan|corp|home|test|invalid|example)$/.test(host)) return false
  return allowedSuffixes().some((suffix) => host === suffix || host.endsWith('.' + suffix))
}
