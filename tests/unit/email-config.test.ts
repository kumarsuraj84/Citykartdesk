import { describe, expect, it } from 'vitest'
import { readSmtpConfig, pickEmailSetup, resolveSenderAddress, defaultEmailFrom, type SmtpConfig } from '@/lib/email/config'

describe('readSmtpConfig', () => {
  it('is off unless SMTP_HOST is set', () => {
    expect(readSmtpConfig({})).toBeNull()
    expect(readSmtpConfig({ SMTP_HOST: '  ' })).toBeNull()
  })

  it('reads Google Workspace settings with sensible defaults', () => {
    expect(readSmtpConfig({ SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'desk@x.com', SMTP_PASS: 'abcd efgh' })).toEqual({
      host: 'smtp.gmail.com', port: 587, secure: false, user: 'desk@x.com', pass: 'abcd efgh', fromAddress: null,
    })
  })

  it('uses implicit TLS for port 465 unless told otherwise', () => {
    expect(readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: '465' })?.secure).toBe(true)
    expect(readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: '465', SMTP_SECURE: 'false' })?.secure).toBe(false)
    expect(readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: '587' })?.secure).toBe(false)
  })

  it('allows a login-less relay (no user/password)', () => {
    const c = readSmtpConfig({ SMTP_HOST: 'smtp-relay.gmail.com' })
    expect(c?.user).toBeNull()
    expect(c?.pass).toBeNull()
  })

  it('falls back to port 587 on a bad port value', () => {
    expect(readSmtpConfig({ SMTP_HOST: 'h', SMTP_PORT: 'abc' })?.port).toBe(587)
  })
})

describe('pickEmailSetup (priority: saved mailbox, server file, Resend, off)', () => {
  const saved: SmtpConfig = { host: 'smtp.gmail.com', port: 587, secure: false, user: 'saved@x.com', pass: 'p', fromAddress: null }

  it('is disabled with nothing configured', () => {
    expect(pickEmailSetup(null, {})).toEqual({ provider: null, smtp: null, source: null })
  })
  it('uses Resend when only its key is set (existing behaviour)', () => {
    expect(pickEmailSetup(null, { RESEND_API_KEY: 're_x' })).toMatchObject({ provider: 'resend', source: 'resend' })
  })
  it('uses the server-file SMTP settings over Resend', () => {
    const r = pickEmailSetup(null, { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'env@x.com', RESEND_API_KEY: 're_x' })
    expect(r).toMatchObject({ provider: 'smtp', source: 'environment' })
    expect(r.smtp?.user).toBe('env@x.com')
  })
  it('the mailbox saved in Settings wins over everything else', () => {
    const r = pickEmailSetup(saved, { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'env@x.com', RESEND_API_KEY: 're_x' })
    expect(r).toMatchObject({ provider: 'smtp', source: 'database' })
    expect(r.smtp?.user).toBe('saved@x.com')
  })
  it('removing the saved mailbox falls back to the server file', () => {
    expect(pickEmailSetup(null, { SMTP_HOST: 'h', SMTP_USER: 'env@x.com' }).source).toBe('environment')
  })
})

describe('resolveSenderAddress', () => {
  const smtp = { host: 'h', port: 587, secure: false, user: 'desk@x.com', pass: 'p', fromAddress: null }

  it('with SMTP, the signed-in mailbox wins over the saved setting (Google rewrites anything else)', () => {
    expect(resolveSenderAddress('smtp', smtp, 'someone@else.com')).toBe('desk@x.com')
  })
  it('SMTP_FROM_ADDRESS (e.g. a Workspace alias) overrides the user', () => {
    expect(resolveSenderAddress('smtp', { ...smtp, fromAddress: 'alias@x.com' }, null)).toBe('alias@x.com')
  })
  it('a login-less relay falls back to the saved address', () => {
    expect(resolveSenderAddress('smtp', { ...smtp, user: null, pass: null }, 'saved@x.com')).toBe('saved@x.com')
  })
  it('with Resend or no provider, the saved address is used as before', () => {
    expect(resolveSenderAddress('resend', null, 'saved@x.com')).toBe('saved@x.com')
    expect(resolveSenderAddress(null, null, '  ')).toBeNull()
  })
})

describe('defaultEmailFrom', () => {
  it('uses the built-in default when EMAIL_FROM is unset or blank (a blank .env line must not mean "no sender")', () => {
    expect(defaultEmailFrom({})).toBe('Citykart Desk <noreply@citykart.org>')
    expect(defaultEmailFrom({ EMAIL_FROM: '' })).toBe('Citykart Desk <noreply@citykart.org>')
    expect(defaultEmailFrom({ EMAIL_FROM: '   ' })).toBe('Citykart Desk <noreply@citykart.org>')
  })
  it('honours a real EMAIL_FROM', () => {
    expect(defaultEmailFrom({ EMAIL_FROM: 'Desk <desk@x.com>' })).toBe('Desk <desk@x.com>')
  })
})
