import nodemailer, { type Transporter } from 'nodemailer'
import { getEmailFrom, RESEND_API_KEY, EMAIL_PROVIDER, SMTP_CONFIG } from './config'

export interface EmailPayload {
  to: string
  subject: string
  html: string
  text?: string
  /** `content` is base64. */
  attachments?: { filename: string; content: string }[]
}

// One pooled connection set for the process, so a burst of notifications (e.g. a
// rule emailing every manager) reuses a few authenticated SMTP sessions instead of
// opening a new TLS connection per message — mail servers throttle those.
let transporter: Transporter | null = null

function getTransporter(): Transporter {
  if (transporter) return transporter
  const c = SMTP_CONFIG!
  const auth = c.user && c.pass ? { user: c.user, pass: c.pass } : undefined
  transporter = nodemailer.createTransport({
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
  return transporter
}

async function sendViaSmtp(p: EmailPayload): Promise<{ error?: string }> {
  const from = await getEmailFrom()
  await getTransporter().sendMail({
    from,
    to: p.to,
    subject: p.subject,
    html: p.html,
    text: p.text,
    attachments: p.attachments?.map((a) => ({ filename: a.filename, content: a.content, encoding: 'base64' })),
  })
  return {}
}

async function sendViaResend(p: EmailPayload): Promise<{ error?: string }> {
  const from = await getEmailFrom()
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
  if (!EMAIL_PROVIDER) {
    console.log('[EMAIL DISABLED] To:', p.to, ' Subject:', p.subject)
    return {}
  }

  try {
    return EMAIL_PROVIDER === 'smtp' ? await sendViaSmtp(p) : await sendViaResend(p)
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
