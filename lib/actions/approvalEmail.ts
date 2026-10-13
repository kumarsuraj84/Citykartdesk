'use server'

// Approve or reject from the link in the approval e-mail. The link names one approver; the visitor must prove they ARE that approver:
// signed in to CK Desk as them, or holding the 6-digit code that is e-mailed only to the approver's own address. A comment is required.

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/email/send'
import { layout } from '@/lib/email/templates'
import { escapeHtml } from '@/lib/email/escape'
import { decideApproval, type ApprovalDb } from '@/lib/approvals/decision'
import { describeApprovalLink } from '@/lib/approvals/email-state'
import {
  VERIFIED_MINUTES, notAuthorisedMessage, approvalCode, codeMatches, isVerified, signVerified, verifiedCookieName, verifyApprovalToken,
} from '@/lib/approvals/email-link'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth: { admin: { getUserById: (id: string) => any } } }
type Result = { error?: string }

const mask = (email: string) => { const [u, d] = email.split('@'); return `${u.slice(0, 1)}${'*'.repeat(Math.max(2, u.length - 1))}@${d}` }

async function approverName(admin: AnyClient, id: string): Promise<string> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()
  return data?.full_name ?? 'the approver'
}

/** Is this visitor the approver? Signed in as them, or carrying the proof they got by code. */
async function identify(token: string): Promise<
  | { ok: true; approvalId: string; approverId: string }
  | { ok: false; error: string; unverified?: boolean }
> {
  const v = verifyApprovalToken(token)
  if (!v) return { ok: false, error: 'This link is not valid.' }
  const viewer = await getCurrentProfile()
  if (viewer?.id === v.approverId) return { ok: true, ...v }
  const proof = (await cookies()).get(verifiedCookieName(v.approvalId))?.value
  if (isVerified(proof, v.approvalId, v.approverId)) return { ok: true, ...v }
  const admin = createAdminClient() as unknown as AnyClient
  if (viewer) return { ok: false, error: notAuthorisedMessage(await approverName(admin, v.approverId)) }
  return { ok: false, error: 'Please confirm it is you first.', unverified: true }
}

/** E-mails a 6-digit code to the approver's own address (never to anyone else), so only they can continue without signing in. */
export async function requestApprovalCode(token: string): Promise<Result & { sentTo?: string }> {
  const v = verifyApprovalToken(token)
  if (!v) return { error: 'This link is not valid.' }
  const admin = createAdminClient() as unknown as AnyClient
  const state = await describeApprovalLink(admin, v.approvalId, v.approverId)
  if (state.kind !== 'pending') return { error: 'This approval is no longer waiting for your decision.' }

  const { limited } = await rateLimit(`approval-code:${v.approvalId}:${v.approverId}`, 3, 10 * 60_000)
  if (limited) return { error: 'A code was sent a moment ago. Please check the e-mail inbox, or wait a few minutes and try again.' }

  const { data } = await admin.auth.admin.getUserById(v.approverId)
  const email: string | undefined = data?.user?.email
  if (!email) return { error: 'No e-mail address is set for this approver.' }

  const code = approvalCode(v.approvalId, v.approverId)
  const html = layout(`
    <p>Hi ${escapeHtml(state.approverName.split(' ')[0] || 'there')},</p>
    <p>Your verification code to approve or reject <strong>${escapeHtml(`${state.requestNo}: ${state.title}`)}</strong> is:</p>
    <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0;">${code}</p>
    <p style="font-size:13px;color:#6B7280;">It works for the next 10 minutes. If you did not open the approval link, ignore this e-mail and do not share the code.</p>
  `)
  const res = await sendEmail({
    to: email, subject: `Your Citykart Desk code: ${code}`, html,
    text: `Your verification code to approve or reject ${state.requestNo} is ${code}. It works for the next 10 minutes. If you did not open the approval link, ignore this e-mail and do not share the code.`,
  })
  if (res.error) return { error: 'The code could not be sent. Please try again.' }
  return { sentTo: mask(email) }
}

export async function verifyApprovalCode(token: string, code: string): Promise<Result> {
  const v = verifyApprovalToken(token)
  if (!v) return { error: 'This link is not valid.' }
  const ip = await getClientIp()
  const [a, b] = await Promise.all([
    rateLimit(`approval-verify:${v.approvalId}:${v.approverId}`, 8, 10 * 60_000),
    ip ? rateLimit(`approval-verify-ip:${ip}`, 30, 10 * 60_000) : Promise.resolve({ limited: false, remaining: 1 }),
  ])
  if (a.limited || b.limited) return { error: 'Too many wrong tries. Please wait a few minutes and request a new code.' }
  if (!codeMatches(v.approvalId, v.approverId, code)) return { error: 'That code is not right or has expired.' }

  const value = signVerified(v.approvalId, v.approverId)
  if (!value) return { error: 'Verification is not available right now.' }
  ;(await cookies()).set(verifiedCookieName(v.approvalId), value, {
    httpOnly: true, sameSite: 'lax', path: '/approve', maxAge: VERIFIED_MINUTES * 60,
    secure: (process.env.NEXT_PUBLIC_APP_URL ?? '').startsWith('https'),
  })
  revalidatePath(`/approve/${token}`)
  return {}
}

/** Approve or reject. Same rules as on the portal (lib/approvals/decision.ts), and a comment is mandatory. */
export async function decideByEmail(token: string, decision: 'approve' | 'reject', comment: string): Promise<Result> {
  if (decision !== 'approve' && decision !== 'reject') return { error: 'Choose approve or reject.' }
  const who = await identify(token)
  if (!who.ok) return { error: who.error }

  const admin = createAdminClient() as unknown as AnyClient
  const { data: me } = await admin.from('profiles').select('id, role, full_name, is_active').eq('id', who.approverId).maybeSingle()
  if (!me || !me.is_active) return { error: 'This approver account is not active.' }

  const res = await decideApproval(decision, who.approvalId, { id: me.id, role: me.role, full_name: me.full_name }, admin as unknown as ApprovalDb, comment, 'email')
  revalidatePath(`/approve/${token}`)
  revalidatePath('/approvals')
  return res
}
