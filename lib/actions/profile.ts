'use server'

import { sanitizeError } from '@/lib/observability/sanitize-error'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { emailPasswordResetLink } from '@/lib/email/auth-mail'
import type { TablesUpdate } from '@/types/database'
import { validateAttachment } from '@/lib/attachments/validate'
import { buildPublicStorageUrl } from '@/lib/storage/publicUrl'
import { checkDisplayName, nameKey } from '@/lib/users/display-name'
import { recordAudit } from '@/lib/syslog/audit'
import { validateAttachmentServer } from '@/lib/attachments/validate-server'

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

  if (!data.full_name?.trim()) {
    return {}
  }

  const checked = checkDisplayName(data.full_name)
  if (!checked.ok) return { error: checked.error }
  const trimmedName = checked.name

  // The name appears next to approvals and comments. A requester may not take the name of a technician, manager or administrator of the organisation
  // (it would let them pose as that person); staff changing their own name is allowed and audited.
  const admin = createAdminClient()
  const { data: me } = await admin.from('profiles').select('role, org_id, full_name').eq('id', user.id).maybeSingle()
  if (me && me.full_name !== trimmedName && me.role === 'user') {
    const { data: staff } = await admin.from('profiles').select('full_name').eq('org_id', me.org_id ?? '').neq('role', 'user').eq('is_active', true)
    const key = nameKey(trimmedName)
    if ((staff ?? []).some((p) => nameKey(p.full_name ?? '') === key)) return { error: 'That name is already used by a member of staff. Please use your own name.' }
  }

  const updateData: Pick<TablesUpdate<'profiles'>, 'full_name' | 'avatar_url'> = {}
  if (trimmedName) updateData.full_name = trimmedName
  if (data.avatar_url !== undefined) updateData.avatar_url = data.avatar_url

  if (Object.keys(updateData).length === 0) return {}

  // Written by the server after the checks above (migration 170 takes the direct right to change these two columns away from the signed-in user).
  const { error } = await admin
    .from('profiles')
    .update(updateData)
    .eq('id', user.id)

  if (error) {
    return { error: sanitizeError(error, { route: 'profile.ts', fallback: 'Something went wrong. Please try again.' }) }
  }
  if (me && me.full_name !== trimmedName) {
    await recordAudit({ category: 'security', action: 'profile.name_changed', entityType: 'user', entityId: user.id, before: { full_name: me.full_name }, after: { full_name: trimmedName }, actorId: user.id, orgId: me.org_id ?? undefined })
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

  // Buffer-level check: this bucket is public and reachable by any
  // authenticated user, not just admins — confirm the bytes actually match
  // the declared/extension-implied image type before publishing them.
  const magicByteCheck = await validateAttachmentServer(file)
  if (!magicByteCheck.valid) return { error: magicByteCheck.error ?? 'File content does not match its declared type.' }

  const admin = createAdminClient()
  const storagePath = `${user.id}/avatar.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: storageError } = await admin.storage
    .from('avatars')
    .upload(storagePath, buffer, { contentType: file.type, upsert: true })

  if (storageError) return { error: 'Upload failed. Please try again.' }

  const avatarUrl = buildPublicStorageUrl('avatars', storagePath)

  const { error: updateError } = await admin
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', user.id)

  if (updateError) return { error: sanitizeError(updateError, { route: 'profile.ts', fallback: 'Something went wrong. Please try again.' }) }

  revalidatePath('/profile')
  return { avatarUrl }
}

export async function sendPasswordResetEmail(): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user || !user.email) return { error: 'Not authenticated.' }

  const { error } = await emailPasswordResetLink(user.email, '/reset-password')
  if (error) return { error }
  return { success: true }
}
