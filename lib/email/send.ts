import { getEmailFrom, RESEND_API_KEY, EMAIL_ENABLED } from './config'

export interface EmailPayload {
  to: string
  subject: string
  html: string
  text?: string
  attachments?: { filename: string; content: string }[]
}

export async function sendEmail(p: EmailPayload): Promise<{ error?: string }> {
  if (!EMAIL_ENABLED) {
    console.log('[EMAIL DISABLED] To:', p.to, ' Subject:', p.subject)
    return {}
  }

  try {
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
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
