import nodemailer, { type Transporter } from 'nodemailer'
import { getEmailFrom, getEmailSetup, RESEND_API_KEY, type EmailSetup, type SmtpConfig } from './config'

export interface EmailPayload {
  to: string
  subject: string
  html: string
  text?: string
  /** `content` is base64. */
  attachments?: { filename: string; content: string }[]
}

// One pooled connection set per SMTP configuration, so a burst of notifications (e.g. a
// rule emailing every manager) reuses a few authenticated sessions instead of opening a
// new TLS connection per message — mail servers throttle those. When the saved mailbox
// changes, the next send builds a fresh transporter and retires the old one.
let cached: { key: string; transporter: Transporter } | null = null

function getTransporter(c: SmtpConfig): Transporter {
  const key = JSON.stringify([c.host, c.port, c.secure, c.user, c.pass])
  if (cached?.key === key) return cached.transporter
  cached?.transporter.close()

  const auth = c.user && c.pass ? { user: c.user, pass: c.pass } : undefined
  const transporter = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth,
    // Never send the mailbox credentials over an unencrypted connection.
    requireTLS: !!auth && !c.secure,
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
    // Fail fast if the SMTP port is blocked instead of hanging the request.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  })
  cached = { key, transporter }
  return transporter
}

async function sendViaSmtp(p: EmailPayload, setup: EmailSetup): Promise<{ error?: string }> {
  const from = await getEmailFrom(setup)
  await getTransporter(setup.smtp!).sendMail({
    from,
    to: p.to,
    subject: p.subject,
    html: p.html,
    text: p.text,
    attachments: p.attachments?.map((a) => ({ filename: a.filename, content: a.content, encoding: 'base64' })),
  })
  return {}
}

async function sendViaResend(p: EmailPayload, setup: EmailSetup): Promise<{ error?: string }> {
  const from = await getEmailFrom(setup)
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: p.to,
      subject: p.subject,
      html: p.html,
      text: p.text,
      ...(p.attachments ? { attachments: p.attachments } : {}),
    }),
  })

  if (!res.ok) return { error: await res.text() }
  return {}
}

export async function sendEmail(p: EmailPayload): Promise<{ error?: string }> {
  try {
    const setup = await getEmailSetup()
    if (!setup.provider) {
      console.log('[EMAIL DISABLED] To:', p.to, ' Subject:', p.subject)
      return {}
    }
    return setup.provider === 'smtp' ? await sendViaSmtp(p, setup) : await sendViaResend(p, setup)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
