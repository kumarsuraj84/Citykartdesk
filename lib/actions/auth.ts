'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { emailPasswordResetLink } from '@/lib/email/auth-mail'

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
  if (byAccount.limited || byAddress.limited) return { error: 'Too many login attempts. Please wait a minute.' }

  const { data: signedIn, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: sanitizeError(error, { route: 'auth.ts#signInWithPassword', fallback: 'Invalid login credentials.' }) }
  }

  // D-010: a deactivated account does not get a session (accounts deactivated before sign-in was blocked at the authentication service)
  if (signedIn?.user?.id) {
    const { data: me } = await supabase.from('profiles').select('is_active').eq('id', signedIn.user.id).maybeSingle()
    if (me && me.is_active === false) {
      await supabase.auth.signOut()
      return { error: 'This account has been deactivated. Please contact your administrator.' }
    }
  }

  // Coming from an approval e-mail: back to that approval after signing in. Only an approval link is honoured, so this cannot
  // be used to send people to some other address.
  const next = String(formData.get('next') ?? '')
  redirect(next.startsWith('/approve/') && /^[A-Za-z0-9._-]{20,200}$/.test(next.slice('/approve/'.length)) ? next : '/home')
}

export async function signOut() {
  const supabase = await createClient()
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
    await supabase.from('profiles').update({ must_reset_password: false }).eq('id', profile.id)
  }

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

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  })
  if (verifyError) return { error: 'Current password is incorrect.' }

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { error: sanitizeError(error, { route: 'auth.ts#changeOwnPassword', fallback: 'Could not update your password. Please try again.' }) }

  return { success: true }
}
