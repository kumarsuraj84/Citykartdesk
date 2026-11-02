import { describe, expect, it } from 'vitest'
import { BRIDGE_HEADER, bridgeHeaders, canonicalString, joinRoles, newNonce, sha256Hex, sign } from '@/lib/ckoneai/sign'

// The four published test vectors of the CKOneAI session (spec v1). The secret below is THEIR test secret and is not used anywhere real.
const SECRET = 'TEST-VECTOR-SECRET-NOT-REAL'
const USER = '11111111-2222-4333-8444-555555555555'
const empty = Buffer.alloc(0)
const body3 = Buffer.from('{"message":"my open tickets"}', 'utf8')
// {"message":"मेरे pending approvals दिखाओ – café"}  (Hindi, an en dash and an accented letter)
const body4 = Buffer.from('7b226d657373616765223a22e0a4aee0a587e0a4b0e0a5872070656e64696e6720617070726f76616c7320e0a4a6e0a4bfe0a496e0a4bee0a49320e2809320636166c3a9227d', 'hex')

const body6 = Buffer.from('{"message":"tickets by category and status this month"}', 'utf8')
const VECTORS = [
  { method: 'GET', target: '/api/ckoneai/capabilities', roles: ['requester'], ts: 1767225600, nonce: '0123456789abcdef', body: empty, sig: '598874e16a514e80a4a71a4f536a20c35d822742d508b8f8352eb3b0b50c9caf' },
  { method: 'GET', target: '/api/ckoneai/conversations?q=open%20tickets&x=1', roles: ['technician', 'requester'], ts: 1767225601, nonce: 'fedcba9876543210', body: empty, sig: '285599fc5f1c25498ebfe878c72a5a34cad04dd8745b188ad0abd49cb9fc085e' },
  { method: 'POST', target: '/api/ckoneai/chat', roles: ['requester'], ts: 1767225602, nonce: '00112233aabbccdd', body: body3, sig: '5ffbe42e50eb3bc09b5cd473e98866a5ba2a756f3039b4439cb7ee6aafcbebdb', bodySha: '6b9ca1ce2194a20ee2264c7c8a30982a530ea5971bc916053d7997c9f7022e1c' },
  { method: 'POST', target: '/api/ckoneai/chat', roles: ['requester', 'approver'], ts: 1767225603, nonce: 'a1b2c3d4e5f60718', body: body4, sig: 'f6873d135e30f3f6ff9a79b3cee7ac6877dd381b3338ec29159d4cc30496a893', bodySha: 'aa30221e1a77db09cc68802deb24cc9c809f51bc4654b7ee9254a8ac5004e066' },
  // vectors 5 to 7: the roles manager and orgwide (CKOneAI commit c62c664, same secret and user)
  { method: 'GET', target: '/api/ckoneai/starters', roles: ['approver', 'manager', 'requester', 'technician'], ts: 1767225604, nonce: '0f1e2d3c4b5a6978', body: empty, sig: 'fc188c26e0c1ffe20511b233924bd424060558905da7f1ba29762ac89fba829b' },
  { method: 'POST', target: '/api/ckoneai/chat', roles: ['orgwide', 'requester'], ts: 1767225605, nonce: '9a8b7c6d5e4f3a2b', body: body6, sig: '02d148618719a267deaa0e15e85185a28adb90892ddc889ed261edd6e9b2bfae', bodySha: 'd0d7f18e7d87cad7aa0d220ccef3da3519ee345ccf9591195ce430b1e32b7ce8' },
  { method: 'GET', target: '/api/ckoneai/conversations?q=sla%20by%20store&limit=5', roles: ['manager', 'requester'], ts: 1767225606, nonce: 'c0ffee0123456789', body: empty, sig: '29f3e8a7af641d9ddefe704345b21ff41f494f7d351fbacef0ba6e36b7fe7253' },
]

describe('CKOneAI bridge signing (published vectors)', () => {
  it.each(VECTORS.map((v, i) => [i + 1, v] as const))('vector %i reproduces the published signature', (_n, v) => {
    expect(sign({ secret: SECRET, method: v.method, target: v.target, userId: USER, roles: v.roles, ts: v.ts, nonce: v.nonce, body: v.body })).toBe(v.sig)
  })

  it('the two body hashes match (the body is hashed as raw bytes, never re-encoded)', () => {
    expect(sha256Hex(body3)).toBe(VECTORS[2].bodySha)
    expect(sha256Hex(body4)).toBe(VECTORS[3].bodySha)
    expect(sha256Hex(body6)).toBe(VECTORS[5].bodySha)
    expect(body3.length).toBe(29)
  })

  it('a GET signs the hash of zero bytes', () => {
    expect(sha256Hex(empty)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('the canonical string is the eight parts joined by newlines, with no trailing newline', () => {
    const c = canonicalString({ method: 'post', target: '/api/ckoneai/chat', userId: USER, roles: ['approver', 'requester'], ts: 5, nonce: '00112233aabbccdd', body: body3 })
    expect(c.split('\n')).toEqual(['POST', '/api/ckoneai/chat', USER, 'approver,requester', 'ckdesk', '5', '00112233aabbccdd', VECTORS[2].bodySha])
    expect(c.endsWith('\n')).toBe(false)
  })

  it('any change to what is signed changes the signature', () => {
    const base = { secret: SECRET, method: 'POST', target: '/api/ckoneai/chat', userId: USER, roles: ['requester'], ts: 1767225602, nonce: '00112233aabbccdd', body: body3 }
    const sig = sign(base)
    expect(sign({ ...base, method: 'GET' })).not.toBe(sig)
    expect(sign({ ...base, target: '/api/ckoneai/chat?a=1' })).not.toBe(sig)
    expect(sign({ ...base, userId: '11111111-2222-4333-8444-555555555556' })).not.toBe(sig)
    expect(sign({ ...base, roles: ['requester', 'technician'] })).not.toBe(sig)
    expect(sign({ ...base, ts: base.ts + 1 })).not.toBe(sig)
    expect(sign({ ...base, nonce: '00112233aabbccde' })).not.toBe(sig)
    expect(sign({ ...base, body: Buffer.from('{"message":"my open tickets "}') })).not.toBe(sig)
    expect(sign({ ...base, secret: SECRET + 'x' })).not.toBe(sig)
  })
})

describe('roles and headers', () => {
  it('roles are sorted, de-duplicated and limited to the three known ones', () => {
    expect(joinRoles(['technician', 'requester', 'requester'])).toBe('requester,technician')
    expect(joinRoles(['approver', 'admin', 'requester', 'platform_owner'])).toBe('approver,requester')
    expect(joinRoles(['technician', 'orgwide', 'manager', 'requester', 'approver'])).toBe('approver,manager,orgwide,requester,technician')
    expect(joinRoles([])).toBe('')
  })

  it('the nonce is 16 lowercase hex characters and does not repeat', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 500; i++) { const n = newNonce(); expect(n).toMatch(/^[0-9a-f]{16}$/); seen.add(n) }
    expect(seen.size).toBe(500)
  })

  it('bridgeHeaders stamps whole seconds and signs exactly what it sends', () => {
    const h = bridgeHeaders({ secret: SECRET, method: 'GET', target: '/api/ckoneai/capabilities', userId: USER, roles: ['requester'], body: empty }, 1767225600_999, '0123456789abcdef')
    expect(h[BRIDGE_HEADER.user]).toBe(USER)
    expect(h[BRIDGE_HEADER.scope]).toBe('ckdesk')
    expect(h[BRIDGE_HEADER.ts]).toBe('1767225600')
    expect(h[BRIDGE_HEADER.roles]).toBe('requester')
    expect(h[BRIDGE_HEADER.sig]).toBe(VECTORS[0].sig)
  })
})
