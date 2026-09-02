'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { getCurrentProfile } from '@/lib/queries/profiles'

export async function signInWithPassword(formData: FormData) {
  const supabase = await createClient()

  const email = (formData.get('email') as string ?? '').toLowerCase().trim()
  const password = formData.get('password') as string

  const ip = await getClientIp()
  const { limited } = await rateLimit(`login:${ip}:${email}`, 10, 60_000)
  if (limited) return { error: 'Too many login attempts. Please wait a minute.' }

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return { error: error.message }
  }

  redirect('/home')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function forgotPassword(formData: FormData) {
  const supabase = await createClient()
  const email = (formData.get('email') as string ?? '').trim().toLowerCase()

  const ip = await getClientIp()
  const { limited } = await rateLimit(`forgot:${ip}`, 5, 300_000)
  if (limited) return { error: 'Too many requests. Please wait 5 minutes.' }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password&type=recovery`,
  })

  if (error) {
    return { error: error.message }
  }

  return { success: true }
}

export async function resetPassword(formData: FormData) {
  const supabase = await createClient()
  const password = formData.get('password') as string

  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    return { error: error.message }
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
  if (error) return { error: error.message }

  return { success: true }
}
