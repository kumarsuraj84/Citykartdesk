// Which addresses of CKOneAI the CK Desk server will forward to: an EXACT list (agreed with the CKOneAI session, 2 Nov 2026). Anything else is refused BEFORE CKOneAI is called.
//   the assistant's API (base /api/ckoneai):
//     GET health | capabilities | starters                  POST chat (answer streams back) | chat/stop | feedback | events/navigation
//     GET, POST conversations                               GET, PATCH, DELETE conversations/{id}      DELETE history      GET messages/{id}
//   the chat page and its files:  GET and HEAD /ckoneai-ui/  /ckoneai-ui/<file>  /ckoneai-ui/assets/<file>   (CKOneAI serves them from ITS root: /ckoneai-ui/<x> is sent upstream as /<x>)
// Not in the list on purpose (CKOneAI closes them for CK Desk callers anyway): question-library, coverage, handoff, everything under admin.
// {id} is hex and hyphens only. No "..", no "%", no backslash, no empty or "." part, no control character, no second "?" in the address.
// The same string is signed and sent, so what CKOneAI verifies is exactly what was checked here.

export type UpstreamKind = 'api' | 'ui'
/** path/search/target = what the browser asked for on this server; upstream = the address that is signed and sent to CKOneAI (the same for the API; for the chat page the prefix /ckoneai-ui is removed, because CKOneAI serves the page from its root) */
export type UpstreamTarget = { kind: UpstreamKind; path: string; search: string; target: string; upstream: string }

const ID = '[0-9a-fA-F-]{8,64}'
const API_ROUTES: { re: RegExp; methods: readonly string[] }[] = [
  { re: /^health$/, methods: ['GET'] },
  { re: /^capabilities$/, methods: ['GET'] },
  { re: /^starters$/, methods: ['GET'] },
  { re: /^chat$/, methods: ['POST'] },
  { re: /^chat\/stop$/, methods: ['POST'] },
  { re: /^feedback$/, methods: ['POST'] },
  { re: /^events\/navigation$/, methods: ['POST'] },
  { re: /^conversations$/, methods: ['GET', 'POST'] },
  { re: new RegExp(`^conversations/${ID}$`), methods: ['GET', 'PATCH', 'DELETE'] },
  { re: /^history$/, methods: ['DELETE'] },
  { re: new RegExp(`^messages/${ID}$`), methods: ['GET'] },
]
const UI_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_QUERY = 2000
const BAD = { ok: false as const, status: 400 as const, error: 'That address is not allowed.' }

export function checkUpstream(pathname: string, search: string, method: string): { ok: true; value: UpstreamTarget } | { ok: false; status: 400 | 405; error: string } {
  if (/[%\\\u0000-\u001f\u007f]/.test(pathname)) return BAD
  if (search !== '' && (!search.startsWith('?') || search.length > MAX_QUERY || /[\u0000-\u001f\u007f#\\]/.test(search) || search.indexOf('?', 1) !== -1)) return BAD
  const m = method.toUpperCase()

  if (pathname.startsWith('/api/ckoneai/')) {
    const rest = pathname.slice('/api/ckoneai/'.length)
    const route = API_ROUTES.find((r) => r.re.test(rest))
    if (!route) return BAD
    if (!route.methods.includes(m)) return { ok: false, status: 405, error: 'That method is not allowed here.' }
    const path = `/api/ckoneai/${rest}`
    return { ok: true, value: { kind: 'api', path, search, target: path + search, upstream: path + search } }
  }

  if (pathname === '/ckoneai-ui' || pathname.startsWith('/ckoneai-ui/')) {
    const rest = pathname.slice('/ckoneai-ui'.length).replace(/^\//, '')
    const segs = rest === '' ? [] : rest.split('/')
    const okShape = segs.length === 0 || (segs.length === 1 && UI_FILE.test(segs[0])) || (segs.length === 2 && segs[0] === 'assets' && UI_FILE.test(segs[1]))
    if (!okShape || segs.some((s) => s.includes('..'))) return BAD
    if (m !== 'GET' && m !== 'HEAD') return { ok: false, status: 405, error: 'That method is not allowed here.' }
    const path = `/ckoneai-ui/${segs.join('/')}`
    return { ok: true, value: { kind: 'ui', path, search, target: path + search, upstream: `/${segs.join('/')}${search}` } }
  }
  return BAD
}
