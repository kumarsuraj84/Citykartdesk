import nodemailer from 'nodemailer'
import type { ImapCredentials } from './credentials.js'

export interface SendOptions {
  from:     string            // "Name <addr@host>"
  to:       string[]
  cc?:      string[]
  subject:  string
  text:     string
  html?:    string
  inReplyTo?: string          // original Message-ID header for threading
  references?: string[]
}

// Derives SMTP settings from the IMAP credentials.
// Gmail and most providers share host / port between IMAP and SMTP.
function smtpTransport(creds: ImapCredentials) {
  // Map known IMAP hosts to their SMTP counterparts. outlook.office365.com (used
  // for M365 IMAP) has no 'imap' token, so map it explicitly.
  const smtpHost = creds.host === 'outlook.office365.com'
    ? 'smtp.office365.com'
    : creds.host.replace('imap.', 'smtp.').replace('imap-', 'smtp.')

  // XOAUTH2 when an access token is present (Gmail / M365 OAuth), else password.
  const auth = creds.accessToken
    ? { type: 'OAuth2' as const, user: creds.user, accessToken: creds.accessToken }
    : { user: creds.user, pass: creds.password }

  return nodemailer.createTransport({
    host: smtpHost,
    port: 587,
    secure: false,
    auth,
    tls: { rejectUnauthorized: false },
  })
}

export async function sendEmail(
  creds: ImapCredentials,
  opts: SendOptions,
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const transport = smtpTransport(creds)
  try {
    const info = await transport.sendMail({
      from:       opts.from,
      to:         opts.to.join(', '),
      cc:         opts.cc?.join(', '),
      subject:    opts.subject,
      text:       opts.text,
      html:       opts.html,
      inReplyTo:  opts.inReplyTo,
      references: opts.references?.join(' '),
    })
    return { ok: true, messageId: info.messageId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'SMTP error' }
  }
}
