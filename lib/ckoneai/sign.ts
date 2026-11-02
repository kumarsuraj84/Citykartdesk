import { createHash, createHmac, randomBytes } from 'node:crypto'

// The signed-header bridge to CKOneAI (the assistant service). Spec v1, agreed with the CKOneAI session (2 Nov 2026):
//
//   x-ckdesk-user    the signed-in person's profile id (uuid)
//   x-ckdesk-roles   the roles CK Desk grants them, sorted, comma-joined (a subset of approver, manager, orgwide, requester, technician; unknown roles are refused by CKOneAI)
//   x-ckdesk-scope   always "ckdesk"
//   x-ckdesk-ts      unix SECONDS (CKOneAI accepts plus or minus 60 s)
//   x-ckdesk-nonce   16 lowercase hex characters from a secure random source, used once
//   x-ckdesk-sig     lowercase hex HMAC-SHA256(secret, canonical string)
//
// canonical string = METHOD LF TARGET LF USER LF ROLES LF SCOPE LF TS LF NONCE LF SHA256_HEX(body)   (UTF-8, no trailing newline)
//   TARGET = the path and query exactly as they are sent to CKOneAI (the upstream path, e.g. /api/ckoneai/chat?x=1), never re-sorted.
//   body   = the exact bytes sent (a GET signs the hash of zero bytes).
//
// Pure functions only: nothing here reads the environment or the clock, so the published test vectors can pin them.

export const BRIDGE_SCOPE = 'ckdesk'
export const BRIDGE_ROLES = ['requester', 'technician', 'approver', 'manager', 'orgwide'] as const
export type BridgeRole = (typeof BRIDGE_ROLES)[number]

export const BRIDGE_HEADER = {
  user: 'x-ckdesk-user',
  roles: 'x-ckdesk-roles',
  scope: 'x-ckdesk-scope',
  ts: 'x-ckdesk-ts',
  nonce: 'x-ckdesk-nonce',
  sig: 'x-ckdesk-sig',
} as const

export const sha256Hex = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex')

/** The roles as the bridge wants them: only the known three, each once, sorted, comma-joined. */
export function joinRoles(roles: readonly string[]): string {
  const known = new Set<string>(BRIDGE_ROLES)
  return [...new Set(roles)].filter((r) => known.has(r)).sort().join(',')
}

export type SignInput = {
  secret: string
  method: string
  target: string
  userId: string
  roles: readonly string[]
  ts: number
  nonce: string
  body: Uint8Array
}

export function canonicalString(i: Omit<SignInput, 'secret'>): string {
  return [i.method.toUpperCase(), i.target, i.userId, joinRoles(i.roles), BRIDGE_SCOPE, String(i.ts), i.nonce, sha256Hex(i.body)].join('\n')
}

export function sign(i: SignInput): string {
  return createHmac('sha256', Buffer.from(i.secret, 'utf8')).update(Buffer.from(canonicalString(i), 'utf8')).digest('hex')
}

/** 16 lowercase hex characters from the operating system's secure random source. */
export function newNonce(): string {
  return randomBytes(8).toString('hex')
}

/** The six headers for one call. `now` is in milliseconds (Date.now()); the stamp is whole seconds. */
export function bridgeHeaders(i: Omit<SignInput, 'ts' | 'nonce'>, now: number = Date.now(), nonce: string = newNonce()): Record<string, string> {
  const ts = Math.floor(now / 1000)
  return {
    [BRIDGE_HEADER.user]: i.userId,
    [BRIDGE_HEADER.roles]: joinRoles(i.roles),
    [BRIDGE_HEADER.scope]: BRIDGE_SCOPE,
    [BRIDGE_HEADER.ts]: String(ts),
    [BRIDGE_HEADER.nonce]: nonce,
    [BRIDGE_HEADER.sig]: sign({ ...i, ts, nonce }),
  }
}
