import { createAdminClient } from '@/lib/supabase/admin'
import { getEmailSetup } from './config'
import { sendEmail } from './send'

/**
 * Password-reset and invitation emails.
 *
 * These used to be sent by the login server's own mailer (GoTrue), which has its own
 * separate mail settings that were never configured on Main — so the app said "sent"
 * and nothing arrived. They now go through the app's normal mailbox (the one set in
 * Admin > Platform Settings), the same as every other email.
 *
 * The link opens /auth/confirm, which shows a "Continue" button and only uses the
 * one-time token when it is clicked. That keeps mail scanners (Gmail, Outlook, antivirus)
 * that pre-open links from using the token up before the person gets to it.
 */

export type AuthLinkType = 'recovery' | 'invite'

export function buildConfirmLink(appUrl: string, tokenHash: string, type: AuthLinkType, next: string): string {
  const base = appUrl.replace(/\/$/, '')
  return `${base}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}&next=${encodeURIComponent(next)}`
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function layout(title: string, intro: string, buttonLabel: string, link: string, note: string): { html: string; text: string } {
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1A1F36">
      <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
      <p style="line-height:1.5">${escapeHtml(intro)}</p>
      <p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#1B2559;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(buttonLabel)}</a></p>
      <p style="font-size:12px;color:#5b6785;line-height:1.5">${escapeHtml(note)}</p>
      <p style="font-size:12px;color:#5b6785;word-break:break-all">If the button does not work, copy this link into your browser:<br>${escapeHtml(link)}</p>
    </div>`
  return { html, text: `${title}\n\n${intro}\n\n${buttonLabel}: ${link}\n\n${note}` }
}

/** True when an outgoing mailbox is configured (saved mailbox, server file, or Resend). */
export async function isEmailConfigured(): Promise<boolean> {
  try {
    return !!(await getEmailSetup()).provider
  } catch {
    return false
  }
}

/**
 * Emails a password-reset link. For an address that has no account this quietly does
 * nothing and reports success, so the form can't be used to discover who has an account.
 */
export async function emailPasswordResetLink(email: string, next = '/reset-password'): Promise<{ error?: string }> {
  const to = email.trim().toLowerCase()
  if (!(await isEmailConfigured())) {
    return { error: 'Email is not set up yet. An admin can set the mailbox in Admin > Platform Settings.' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: to })
  if (error || !data?.properties?.hashed_token) {
    // Unknown address: behave exactly as if it was sent.
    if (error && /not.?found|no user|does not exist/i.test(error.message)) return {}
    return { error: 'Could not create the reset link. Please try again.' }
  }

  const link = buildConfirmLink(process.env.NEXT_PUBLIC_APP_URL ?? '', data.properties.hashed_token, 'recovery', next)
  const { html, text } = layout(
    'Reset your Citykart Desk password',
    'We received a request to reset the password for your Citykart Desk account.',
    'Choose a new password',
    link,
    'This link works once and expires in about an hour. If you did not ask for this, you can ignore this email — your password will not change.',
  )
  const res = await sendEmail({ to, subject: 'Reset your Citykart Desk password', html, text })
  return res.error ? { error: 'The email could not be sent. Please try again or contact your admin.' } : {}
}

/** Builds the "set your password" invitation for a just-created user. */
export async function emailInvitation(email: string, tokenHash: string, fullName: string): Promise<{ error?: string; skipped?: boolean }> {
  if (!(await isEmailConfigured())) return { skipped: true }
  const link = buildConfirmLink(process.env.NEXT_PUBLIC_APP_URL ?? '', tokenHash, 'invite', '/reset-password')
  const { html, text } = layout(
    'Welcome to Citykart Desk',
    `Hi ${fullName || 'there'}, an account has been created for you on Citykart Desk. Set your password to get started.`,
    'Set your password',
    link,
    'This link works once. If it has expired, use "Forgot password" on the sign-in page.',
  )
  const res = await sendEmail({ to: email.trim().toLowerCase(), subject: 'Welcome to Citykart Desk — set your password', html, text })
  return res.error ? { error: res.error } : {}
}
