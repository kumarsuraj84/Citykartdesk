// Pages that anyone can reach without signing in post only small forms (a password, an e-mail address, a comment). Next.js allows 30 MB for a
// server action everywhere (needed for attachments, which are signed-in only), so the proxy refuses a larger body on the public pages before
// the action runs (D-039): otherwise a stranger could make the server read and buffer 30 MB per request on the login page.

export const PUBLIC_ACTION_BODY_LIMIT = 256 * 1024

const PUBLIC_PAGE = /^\/(login|auth|forgot-password|reset-password|approve|csat)(\/|$)/

/** True when this is a server-action post to a public page with a body that is too large, or whose size is not declared. */
export function publicActionBodyTooLarge(method: string, pathname: string, headers: Headers): boolean {
  if (method !== 'POST' || !PUBLIC_PAGE.test(pathname)) return false
  if (!headers.has('next-action')) return false
  const declared = headers.get('content-length')
  const length = declared === null ? NaN : Number(declared)
  return !Number.isFinite(length) || length > PUBLIC_ACTION_BODY_LIMIT
}
