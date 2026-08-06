'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

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

export async function signInWithMagicLink(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  })

  if (error) {
    return { error: error.message }
  }

  return { success: true }
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
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/auth/reset-password&type=recovery`,
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

  redirect('/home')
}
