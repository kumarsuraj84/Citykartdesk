'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function updateProfile(data: {
  full_name?: string
  avatar_url?: string
}): Promise<{ error?: string }> {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: 'Not authenticated.' }
  }

  const trimmedName = data.full_name?.trim()

  if (!trimmedName) {
    return {}
  }

  if (trimmedName.length < 2) {
    return { error: 'Full name must be at least 2 characters.' }
  }

  const updateData: Record<string, string> = {}
  if (trimmedName) updateData.full_name = trimmedName
  if (data.avatar_url !== undefined) updateData.avatar_url = data.avatar_url

  if (Object.keys(updateData).length === 0) return {}

  const { error } = await supabase
    .from('profiles')
    .update(updateData)
    .eq('id', user.id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/profile')
  return {}
}

export async function uploadAvatar(formData: FormData): Promise<{ avatarUrl?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'Not authenticated.' }

  const file = formData.get('avatar')
  if (!file || !(file instanceof File)) return { error: 'No file provided.' }
  if (file.size === 0) return { error: 'The file is empty.' }
  if (file.size > 5 * 1024 * 1024) return { error: 'File too large. Maximum size is 5 MB.' }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const allowed = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
  if (!allowed.has(ext)) return { error: 'Only PNG, JPG, GIF, and WEBP files are allowed.' }

  const admin = createAdminClient()
  const storagePath = `${user.id}/avatar.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: storageError } = await admin.storage
    .from('avatars')
    .upload(storagePath, buffer, { contentType: file.type, upsert: true })

  if (storageError) return { error: 'Upload failed. Please try again.' }

  const { data: { publicUrl } } = admin.storage.from('avatars').getPublicUrl(storagePath)

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ avatar_url: publicUrl })
    .eq('id', user.id)

  if (updateError) return { error: updateError.message }

  revalidatePath('/profile')
  return { avatarUrl: publicUrl }
}

export async function sendPasswordResetEmail(): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user || !user.email) return { error: 'Not authenticated.' }

  const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/profile`,
  })

  if (error) return { error: error.message }
  return { success: true }
}
