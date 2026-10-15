'use server'

import { redirect } from 'next/navigation'
import { safeNextPath } from '@/lib/auth/safe-next'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { emailPasswordResetLink } from '@/lib/email/auth-mail'
import { recordAudit } from '@/lib/syslog/audit'

export async function signInWithPassword(formData: FormData) {
  const supabase = await createClient()

  const email = (formData.get('email') as string ?? '').toLowerCase().trim()
  const password = formData.get('password') as string

  // The limit follows the ACCOUNT being tried, not a client-supplied address, so changing request headers does not buy more guesses (D-017).
  // A per-address limit is added only when the address can be trusted (see getClientIp).
  const ip = await getClientIp()
  const [byAccount, byAddress] = await Promise.all([
    rateLimit(`login:${email}`, 10, 60_000),
    ip ? rateLimit(`login-ip:${ip}`, 60, 60_000) : Promise.resolve({ limited: false, remaining: 1 }),
  ])
  if (byAccount.limited || byAddress.limited) {
    await recordAudit({ category: 'security', source: 'auth', action: 'auth.login_rate_limited', outcome: 'denied', severity: 'warning', message: 'Too many sign-in attempts', after: { email } })
    return { error: 'Too many login attempts. Please wait a minute.' }
  }

  const { data: signedIn, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    await recordAudit({ category: 'security', source: 'auth', action: 'auth.login_failed', outcome: 'failure', severity: 'warning', message: 'Sign-in refused', after: { email } })
    return { error: sanitizeError(error, { route: 'auth.ts#signInWithPassword', fallback: 'Invalid login credentials.' }) }
  }

  // D-010: a deactivated account does not get a session (accounts deactivated before sign-in was blocked at the authentication service)
  if (signedIn?.user?.id) {
    const { data: me } = await supabase.from('profiles').select('is_active').eq('id', signedIn.user.id).maybeSingle()
    if (me && me.is_active === false) {
      await supabase.auth.signOut()
      await recordAudit({ category: 'security', source: 'auth', action: 'auth.login_blocked_deactivated', outcome: 'denied', severity: 'warning', actorId: signedIn.user.id, after: { email } })
      return { error: 'This account has been deactivated. Please contact your administrator.' }
    }
    await recordAudit({ category: 'security', source: 'auth', action: 'auth.login_succeeded', actorId: signedIn.user.id, after: { email } })
  }

  // Back to the page the person was trying to open (an approval e-mail, a bookmarked ticket...). Only a path inside this site is honoured
  // (safeNextPath, audit D-034), so this cannot be used to send people to some other address.
  redirect(safeNextPath(String(formData.get('next') ?? ''), '/home'))
}

export async function signOut() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) await recordAudit({ category: 'security', source: 'auth', action: 'auth.logout', actorId: user.id })
  await supabase.auth.signOut()
  redirect('/login')
}

export async function forgotPassword(formData: FormData) {
  const email = (formData.get('email') as string ?? '').trim().toLowerCase()

  if (!email) return { error: 'Please enter your email address.' }

  // per address being mailed (a reset e-mail can no longer be sent to one person over and over), plus per caller address when it is trustworthy
  const ip = await getClientIp()
  const [byEmail, byAddress] = await Promise.all([
    rateLimit(`forgot:${email}`, 3, 3_600_000),
    ip ? rateLimit(`forgot-ip:${ip}`, 5, 300_000) : Promise.resolve({ limited: false, remaining: 1 }),
  ])
  if (byEmail.limited || byAddress.limited) return { error: 'Too many requests. Please wait before trying again.' }

  // Sent through the app's own mailbox (see lib/email/auth-mail.ts).
  const { error } = await emailPasswordResetLink(email)
  await recordAudit({ category: 'security', source: 'auth', action: 'auth.password_reset_requested', outcome: error ? 'failure' : 'success', after: { email }, message: error ? 'The reset e-mail could not be sent' : null })
  if (error) return { error }

  return { success: true }
}

export async function resetPassword(formData: FormData) {
  const password = formData.get('password') as string
  // This is the exact path a bulk-imported user hits when leaving the shared
  // DEFAULT_BULK_PASSWORD (admin/users.ts) — it must not be allowed to land
  // on something weaker than what an admin is even permitted to set directly.
  if (!password || password.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    return { error: sanitizeError(error, { route: 'auth.ts#resetPassword', fallback: 'Could not update your password. Please try again.' }) }
  }

  // Covers both an invite/recovery link AND the forced-reset redirect from
  // app/(app)/layout.tsx (bulkCreateUsers/adminSetPassword flip this flag) —
  // clearing it here is a no-op for anyone who wasn't flagged.
  const profile = await getCurrentProfile()
  if (profile?.must_reset_password) {
    // only the server clears it, and only here, after the password really changed (a signed-in user has no right to switch it off: VAPT VA-API-02)
    await createAdminClient().from('profiles').update({ must_reset_password: false }).eq('id', profile.id)
  }
  await recordAudit({ category: 'security', source: 'auth', action: 'auth.password_changed', actorId: profile?.id ?? null, message: 'Password set through a reset or invitation link' })

  redirect('/home')
}

// ── changeOwnPassword ─────────────────────────────────────────────────────────
// Voluntary, logged-in self-service change (Account Settings) — unlike
// resetPassword (used for invite/recovery links and the forced-reset gate,
// neither of which can prove the user is who they claim beyond the session
// itself), this one re-verifies the current password first since the user is
// choosing to change a password they already know.

export async function changeOwnPassword(formData: FormData): Promise<{ error?: string; success?: boolean }> {
  const currentPassword = formData.get('currentPassword') as string
  const newPassword = formData.get('newPassword') as string
  if (!currentPassword) return { error: 'Enter your current password.' }
  if (!newPassword || newPassword.length < 8) return { error: 'New password must be at least 8 characters.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'Not authenticated.' }

  // checking the current password is itself a password guess: it is limited like a sign-in (VAPT VA-TKT-18)
  if ((await rateLimit(`change-password:${user.id}`, 5, 10 * 60_000)).limited) return { error: 'Too many attempts. Please wait a few minutes and try again.' }
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  })
  if (verifyError) return { error: 'Current password is incorrect.' }

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { error: sanitizeError(error, { route: 'auth.ts#changeOwnPassword', fallback: 'Could not update your password. Please try again.' }) }
  await recordAudit({ category: 'security', source: 'auth', action: 'auth.password_changed', actorId: user.id, message: 'Password changed by the user' })
  // a changed password ends every OTHER session of this person (a stolen session must not survive it): VAPT VA-API-09 / VA-TKT-18
  try { await supabase.auth.signOut({ scope: 'others' }) } catch { /* the password is changed either way */ }

  return { success: true }
}
