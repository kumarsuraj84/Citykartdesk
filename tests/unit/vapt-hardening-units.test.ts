// VAPT 2026-10: small pure-code regressions (no database needed).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { mailHostProblem } from '@/lib/validation/mail-host'
import { safePublicStoragePath } from '@/lib/storage/publicPath'

describe('mail server address (earlier D-026, residual forms)', () => {
  it('refuses shortcut spellings of the local machine', () => {
    for (const h of ['127.1', '0177.0.0.1', '127.0.1', '0x7f.0.0.1', '2130706433', '0.0.0.0', '127.0.0.1', 'localhost', '169.254.169.254', '10.1', '1.2.3']) {
      expect(mailHostProblem(h), h).toBeTruthy()
    }
  })
  it('still accepts real mail servers, by name and by plain private address', () => {
    for (const h of ['smtp.gmail.com', 'mail.citykart.org', '10.0.0.30', '192.168.1.5']) expect(mailHostProblem(h), h).toBeNull()
  })
})

describe('public storage path (VA-API-14: the dot was loose)', () => {
  const id = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b'
  it('accepts exactly the shapes the application uploads', () => {
    expect(safePublicStoragePath('icons', [`${id}.png`])).toBe(`${id}.png`)
    expect(safePublicStoragePath('avatars', [id, 'avatar.webp'])).toBe(`${id}/avatar.webp`)
  })
  it('refuses a character in place of the dot', () => {
    expect(safePublicStoragePath('icons', [`${id}Xpng`])).toBeNull()
    expect(safePublicStoragePath('avatars', [id, 'avatarXpng'])).toBeNull()
  })
})

describe('proxy: only root-level static files skip the session check (VA-API-04)', () => {
  // the pattern is read from proxy.ts itself, so the test follows the real code
  const line = readFileSync('proxy.ts', 'utf8').split('\n').find((l) => l.includes('root-level files of /public only')) ?? ''
  const literal = line.trim().slice(0, line.trim().indexOf('.test(pathname)'))
  const re = new RegExp(literal.slice(1, literal.lastIndexOf('/')))
  it('matches a logo at the root', () => { expect(re.test('/citykart-desk-icon.png')).toBe(true) })
  it('does not match page-looking or nested paths', () => {
    for (const p of ['/requests/x.png', '/approve/abc.png', '/api/requests/1/pdf.png', '/a/b.svg']) expect(re.test(p), p).toBe(false)
  })
})

describe('a few code-level rules the assessment relies on', () => {
  it('a signed-in user has no way to clear the forced password change from the application code', () => {
    const auth = readFileSync('lib/actions/auth.ts', 'utf8')
    expect(auth).toMatch(/createAdminClient\(\)\.from\('profiles'\)\.update\(\{ must_reset_password: false \}\)/)
    expect(auth).not.toMatch(/supabase\.from\('profiles'\)\.update\(\{ must_reset_password: false \}\)/)
  })
  it('the approval code is never put in the subject of the mail (the subject is written to the Event Log)', () => {
    expect(readFileSync('lib/actions/approvalEmail.ts', 'utf8')).not.toMatch(/subject:\s*`[^`]*\$\{code\}/)
  })
  it('tickets are created by the server only', () => {
    expect(readFileSync('lib/actions/requests.ts', 'utf8')).toMatch(/useAdminForWrites: true/)
  })
})

import { targetGuardError } from '@/lib/admin/target-guard'
describe('who may change whom (VA-ADM-05)', () => {
  const manager = { id: 'm1', role: 'manager' }, admin = { id: 'a1', role: 'admin' }, owner = { id: 'o1', role: 'platform_owner' }, user = { id: 'u1', role: 'user' }
  it('a manager cannot edit an administrator or platform owner, cannot attach mobile numbers, cannot change their own groups', () => {
    expect(targetGuardError(manager, admin, 'profile')).toBeTruthy()
    expect(targetGuardError(manager, owner, 'teams')).toBeTruthy()
    expect(targetGuardError(manager, user, 'phone')).toBeTruthy()
    expect(targetGuardError(manager, manager, 'teams')).toBeTruthy()
  })
  it('a manager can still edit an ordinary user and set their groups', () => {
    expect(targetGuardError(manager, user, 'profile')).toBeNull()
    expect(targetGuardError(manager, user, 'teams')).toBeNull()
  })
  it('an administrator can manage mobile numbers of ordinary users, but not of a platform owner', () => {
    expect(targetGuardError(admin, user, 'phone')).toBeNull()
    expect(targetGuardError(admin, owner, 'phone')).toBeTruthy()
    expect(targetGuardError(owner, admin, 'phone')).toBeNull()
  })
})

import { senderAuthenticity } from '@/lib/email/inbound-auth'
describe('inbound mail sender check (VA-INT-07)', () => {
  it('a DMARC pass for another domain does not vouch for the employee address in the From line', () => {
    const h = 'mx.google.com; dmarc=pass header.from=attacker.example'
    expect(senderAuthenticity(h, 'ceo@citykart.org').verdict).not.toBe('authentic')
  })
  it('a DMARC pass for the sender\'s own domain still counts', () => {
    expect(senderAuthenticity('mx.google.com; dmarc=pass header.from=citykart.org', 'ceo@citykart.org').verdict).toBe('authentic')
    expect(senderAuthenticity('mx.google.com; dmarc=pass', 'ceo@citykart.org').verdict).toBe('authentic')
  })
})
