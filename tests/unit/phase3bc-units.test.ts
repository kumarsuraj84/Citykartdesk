// Phase 3B/3C building blocks: Google token check, upload inspection and scanner protocol, display names, session methods, push addresses, export guard,
// organisation domains, Store Master limits. Everything runs in memory or on the loopback interface; nothing leaves this machine.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateKeyPairSync, createSign } from 'node:crypto'
import net from 'node:net'
import { deflateRawSync } from 'node:zlib'

vi.mock('server-only', () => ({}))

import { verifyGoogleOidc, resetGoogleKeyCache, type GoogleKey } from '@/lib/intake/google-oidc'
import { containsMacros, clamdScan, inspectBytes, scannerStatus } from '@/lib/attachments/scan'
import { checkDisplayName, nameKey } from '@/lib/users/display-name'
import { decodeAmr, startedByRecentLink } from '@/lib/auth/session-methods'
import { isAcceptablePushEndpoint } from '@/lib/push/endpoint'
import { checkReportConfigShape } from '@/lib/security/export-guard'
import { parseDomainList, isOrganisationAddress } from '@/lib/email/org-domains'
import { readStoreMasterFile, MAX_STORE_FILE_COLUMNS } from '@/lib/stores/master-file'

const b64u = (o: unknown) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')

describe('VAPT-042: Google Pub/Sub signed token', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1', alg: 'RS256', use: 'sig' } as GoogleKey
  const expected = { audience: 'https://desk.example.test/api/intake/webhook/gmail', email: 'push@proj.iam.gserviceaccount.com' }
  const now = Date.now()
  function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = privateKey) {
    const h = b64u({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...header })
    const p = b64u({ iss: 'https://accounts.google.com', aud: expected.audience, email: expected.email, email_verified: true, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600, ...claims })
    const sig = createSign('RSA-SHA256').update(`${h}.${p}`).sign(key).toString('base64url')
    return `Bearer ${h}.${p}.${sig}`
  }
  const opts = { fetchKeys: async () => [jwk], now }
  beforeEach(() => resetGoogleKeyCache())

  it('accepts a correctly signed token for exactly this audience and service account', async () => {
    expect(await verifyGoogleOidc(token(), expected, opts)).toEqual({ ok: true, email: expected.email })
  })
  it('refuses a wrong audience, a wrong service account, an expired token and an unverified address', async () => {
    expect(await verifyGoogleOidc(token({ aud: 'https://evil.example/' }), expected, opts)).toMatchObject({ ok: false, reason: 'wrong audience' })
    expect(await verifyGoogleOidc(token({ email: 'other@proj.iam.gserviceaccount.com' }), expected, opts)).toMatchObject({ ok: false, reason: 'wrong service account' })
    expect(await verifyGoogleOidc(token({ exp: Math.floor(now / 1000) - 3600 }), expected, opts)).toMatchObject({ ok: false, reason: 'expired' })
    expect(await verifyGoogleOidc(token({ email_verified: false }), expected, opts)).toMatchObject({ ok: false })
    expect(await verifyGoogleOidc(token({ iss: 'https://evil.example' }), expected, opts)).toMatchObject({ ok: false, reason: 'wrong issuer' })
  })
  it('refuses "alg: none", a symmetric algorithm, a token signed with another key, an unknown key id and a missing token', async () => {
    expect(await verifyGoogleOidc(token({}, { alg: 'none' }), expected, opts)).toMatchObject({ ok: false, reason: 'unexpected algorithm' })
    expect(await verifyGoogleOidc(token({}, { alg: 'HS256' }), expected, opts)).toMatchObject({ ok: false, reason: 'unexpected algorithm' })
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    expect(await verifyGoogleOidc(token({}, {}, other), expected, opts)).toMatchObject({ ok: false, reason: 'bad signature' })
    expect(await verifyGoogleOidc(token({}, { kid: 'nope' }), expected, opts)).toMatchObject({ ok: false, reason: 'unknown signing key' })
    expect(await verifyGoogleOidc(null, expected, opts)).toMatchObject({ ok: false })
    expect(await verifyGoogleOidc('Bearer not.a.jwt!', expected, opts)).toMatchObject({ ok: false })
  })
  it('refuses when Google\'s keys cannot be fetched (fails closed)', async () => {
    expect(await verifyGoogleOidc(token(), expected, { fetchKeys: async () => { throw new Error('offline') }, now })).toMatchObject({ ok: false, reason: 'signing keys unavailable' })
  })
})

describe('VAPT-065: macros and the scanner', () => {
  const ole = (extra: Buffer) => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512), extra])
  const zip = (name: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26), Buffer.from(name), Buffer.alloc(40)])
  const env = { ...process.env }
  afterEach(() => { process.env = { ...env } })

  it('finds a VBA project in an old Office file and in an OOXML / zip file; leaves clean files alone', () => {
    expect(containsMacros(ole(Buffer.from('_VBA_PROJECT', 'utf16le')))).toBe(true)
    expect(containsMacros(ole(Buffer.from('Workbook', 'utf16le')))).toBe(false)
    expect(containsMacros(zip('xl/vbaProject.bin'))).toBe(true)
    expect(containsMacros(zip('xl/worksheets/sheet1.xml'))).toBe(false)
    expect(containsMacros(Buffer.from('plain text, nothing here'))).toBe(false)
  })
  it('refuses a macro file unless the owner allowed it', async () => {
    const bytes = new Uint8Array(zip('word/vbaProject.bin'))
    expect(await inspectBytes(bytes)).toMatchObject({ ok: false, code: 'macro' })
    process.env.ALLOW_MACRO_OFFICE_FILES = '1'
    expect(await inspectBytes(bytes)).toMatchObject({ ok: true })
  })
  it('says honestly when no scanner is configured (nothing scanned)', async () => {
    delete process.env.ATTACHMENT_SCANNER
    expect(scannerStatus().configured).toBe(false)
    expect(await inspectBytes(new Uint8Array(Buffer.from('hello')))).toEqual({ ok: true, scanned: false })
  })

  // a stand-in for clamd that speaks the real INSTREAM protocol on the loopback interface
  function fakeClamd(verdict: (data: Buffer) => string | 'hang' | 'drop') {
    const server = net.createServer((sock) => {
      const chunks: Buffer[] = []
      sock.on('data', (d) => {
        chunks.push(d)
        const all = Buffer.concat(chunks)
        const head = all.indexOf(0)
        if (head < 0) return
        // after "zINSTREAM\0": <4-byte length><bytes> ... <4 zero bytes>
        let off = head + 1; const body: Buffer[] = []
        while (off + 4 <= all.length) {
          const len = all.readUInt32BE(off); off += 4
          if (len === 0) {
            const v = verdict(Buffer.concat(body))
            if (v === 'drop') return sock.destroy()
            if (v !== 'hang') sock.end(v + '\0')
            return
          }
          if (off + len > all.length) return
          body.push(all.subarray(off, off + len)); off += len
        }
      })
    })
    return new Promise<{ port: number; close: () => void }>((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() })))
  }

  it('talks the clamd protocol: clean, infected, and the whole file arrives intact', async () => {
    const seen: number[] = []
    const srv = await fakeClamd((d) => { seen.push(d.length); return d.toString().includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK' })
    try {
      const big = Buffer.alloc(200_000, 7)
      expect(await clamdScan(big, '127.0.0.1', srv.port)).toBe('stream: OK')
      expect(seen[0]).toBe(200_000)
      expect(await clamdScan(Buffer.from('X5O!P%@AP EICAR-STANDARD'), '127.0.0.1', srv.port)).toMatch(/FOUND$/)
    } finally { srv.close() }
  })
  it('refuses an infected file; refuses (fails closed) when the scanner is down or silent; lets through only when the owner chose "allow"', async () => {
    const srv = await fakeClamd((d) => (d.toString().includes('EICAR') ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK'))
    process.env.ATTACHMENT_SCANNER = 'clamd'; process.env.ATTACHMENT_SCANNER_HOST = '127.0.0.1'; process.env.ATTACHMENT_SCANNER_PORT = String(srv.port)
    try {
      expect(await inspectBytes(new Uint8Array(Buffer.from('a clean file')))).toEqual({ ok: true, scanned: true })
      expect(await inspectBytes(new Uint8Array(Buffer.from('EICAR')))).toMatchObject({ ok: false, code: 'infected' })
    } finally { srv.close() }
    // the scanner is now gone
    expect(await inspectBytes(new Uint8Array(Buffer.from('a clean file')))).toMatchObject({ ok: false, code: 'scan_unavailable' })
    process.env.ATTACHMENT_SCAN_ON_ERROR = 'allow'
    expect(await inspectBytes(new Uint8Array(Buffer.from('a clean file')))).toEqual({ ok: true, scanned: false })
  })
  it('refuses when the scanner answers something unexpected', async () => {
    const srv = await fakeClamd(() => 'stream: ERROR something')
    process.env.ATTACHMENT_SCANNER = 'clamd'; process.env.ATTACHMENT_SCANNER_HOST = '127.0.0.1'; process.env.ATTACHMENT_SCANNER_PORT = String(srv.port)
    try { expect(await inspectBytes(new Uint8Array(Buffer.from('x')))).toMatchObject({ ok: false, code: 'scan_unavailable' }) } finally { srv.close() }
  })
})

describe('VAPT-061: display names and sessions', () => {
  it('accepts ordinary names and store logins', () => {
    for (const n of ['Asha Verma', 'Ravi K. Nair', "D'Souza", 'José Álvarez', 'NLD', 'Sm. NEG (Noida)', 'अनिल कुमार']) expect(checkDisplayName(n), n).toMatchObject({ ok: true })
    expect(checkDisplayName('  Asha   Verma ')).toEqual({ ok: true, name: 'Asha Verma' })
  })
  it('refuses markup, invisible and direction-changing characters, and bad lengths', () => {
    for (const n of ['<b>Boss</b>', 'a', 'x'.repeat(81), 'Asha‮Verma', 'Asha​Verma', 'Asha\nVerma<script>', 'Asha; DROP', '😀😀'])
      expect(checkDisplayName(n).ok, JSON.stringify(n)).toBe(false)
  })
  it('compares names without case, accents or spacing', () => {
    expect(nameKey('  José   Álvarez ')).toBe(nameKey('jose alvarez'))
    expect(nameKey('A.B. Rao')).toBe(nameKey('a b rao'))
  })
  it('reads how a session started: a recent recovery link counts, an old one or a password sign-in does not', () => {
    const jwt = (amr: unknown) => `x.${b64u({ amr })}.y`
    const now = Date.now()
    expect(decodeAmr(jwt([{ method: 'recovery', timestamp: 1 }]))).toEqual([{ method: 'recovery', timestamp: 1 }])
    expect(startedByRecentLink(jwt([{ method: 'recovery', timestamp: Math.floor(now / 1000) - 60 }]), 60, now)).toBe(true)
    expect(startedByRecentLink(jwt([{ method: 'recovery', timestamp: Math.floor(now / 1000) - 7200 }]), 60, now)).toBe(false)
    expect(startedByRecentLink(jwt([{ method: 'password', timestamp: Math.floor(now / 1000) }]), 60, now)).toBe(false)
    expect(startedByRecentLink('garbage', 60, now)).toBe(false)
    expect(startedByRecentLink(null)).toBe(false)
  })
})

describe('VAPT-036: push addresses', () => {
  it('accepts only the browsers\' own push services', () => {
    expect(isAcceptablePushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true)
    expect(isAcceptablePushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true)
    expect(isAcceptablePushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=1')).toBe(true)
    expect(isAcceptablePushEndpoint('https://web.push.apple.com/x')).toBe(true)
  })
  it('refuses an ordinary public https address, look-alike hosts and anything internal', () => {
    for (const e of ['https://example.org/hook', 'https://attacker.example.net/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.net/x', 'https://evilfcm.googleapis.com.attacker.io/x', 'https://notify.windows.com.evil.net/x', 'https://127.0.0.1/x', 'https://10.0.0.205/x'])
      expect(isAcceptablePushEndpoint(e), e).toBe(false)
  })
  it('lets the owner add a push service of their own, and nothing else changes', () => {
    process.env.PUSH_ENDPOINT_EXTRA_HOSTS = 'push.corp-notify.net'
    try {
      expect(isAcceptablePushEndpoint('https://eu.push.corp-notify.net/x')).toBe(true)
      expect(isAcceptablePushEndpoint('https://example.org/x')).toBe(false)
    } finally { delete process.env.PUSH_ENDPOINT_EXTRA_HOSTS }
  })
})

describe('VAPT-051 / 052: report settings shape and organisation domains', () => {
  it('accepts a normal Report Builder configuration and refuses a malformed or oversized one', () => {
    expect(checkReportConfigShape({ mode: 'table', columns: ['a', 'b'], pivot: { rows: [], filters: [] } })).toBeNull()
    expect(checkReportConfigShape(null)).not.toBeNull()
    expect(checkReportConfigShape({ mode: 'sql', columns: [], pivot: {} })).not.toBeNull()
    expect(checkReportConfigShape({ mode: 'table', columns: [1], pivot: {} })).not.toBeNull()
    expect(checkReportConfigShape({ mode: 'table', columns: Array(81).fill('x'), pivot: {} })).not.toBeNull()
    expect(checkReportConfigShape({ mode: 'pivot', columns: [], pivot: { big: 'x'.repeat(30_000) } })).not.toBeNull()
  })
  it('knows the organisation\'s own mail domains', () => {
    expect(parseDomainList('Citykart.org, @desk.citykart.org ,junk, ')).toEqual(['citykart.org', 'desk.citykart.org'])
    expect(isOrganisationAddress('Asha@Citykart.org', ['citykart.org'])).toBe(true)
    expect(isOrganisationAddress('asha@citykart.org.evil.net', ['citykart.org'])).toBe(false)
    expect(isOrganisationAddress('asha@evilcitykart.org', ['citykart.org'])).toBe(false)
    expect(isOrganisationAddress('nobody', ['citykart.org'])).toBe(false)
  })
})

describe('VAPT-068: Store Master workbook limits', () => {
  /** A one-entry zip whose directory declares `declared` bytes while the entry really holds `real` bytes of zeros. */
  function zipThatLies(real: number, declared: number): Buffer {
    const data = deflateRawSync(Buffer.alloc(real))
    const name = Buffer.from('xl/sharedStrings.xml')
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(declared, 22); local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10)
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(declared, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42)
    const body = Buffer.concat([local, name, data])
    const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10)
    eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(body.length, 16)
    return Buffer.concat([body, central, name, eocd])
  }
  const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

  it('refuses a small workbook that declares 1 KB but unpacks to far more than the limit, before the spreadsheet reader sees it', async () => {
    const bomb = zipThatLies(60 * 1024 * 1024, 1024)
    expect(bomb.length).toBeLessThan(1024 * 1024)
    const res = await readStoreMasterFile('stores.xlsx', ab(bomb))
    expect('error' in res && res.error).toMatch(/too large|not a valid/i)
  })
  it('refuses one that honestly declares more than the limit', async () => {
    const res = await readStoreMasterFile('stores.xlsx', ab(zipThatLies(50 * 1024 * 1024, 50 * 1024 * 1024)))
    expect('error' in res && res.error).toMatch(/too large|not a valid/i)
  })
  it('keeps the column limit documented', () => expect(MAX_STORE_FILE_COLUMNS).toBe(100))
})
