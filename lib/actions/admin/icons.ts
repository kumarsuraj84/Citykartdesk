'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { validateAttachment } from '@/lib/attachments/validate'

// ── Guard: admin-only ─────────────────────────────────────────────────────────
// Same guard as lib/actions/admin/services.ts's requireAdmin() — deliberately
// duplicated rather than shared, kept byte-for-byte identical.

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin', 'platform_owner'].includes(profile.role)) return { error: 'Admin role required.' }
  return { profile }
}

// ── uploadIconImage ───────────────────────────────────────────────────────────
// Generic icon-image uploader for Services/Categories/Sub-Categories — mirrors
// uploadAvatar() in lib/actions/profile.ts. Unlike an avatar (always has a
// stable user id already), a brand-new Service/Category/Sub-Category doesn't
// have an id yet at create time, so this uses a random storage path rather
// than a deterministic one keyed on the entity — it just returns a public URL,
// the caller is responsible for including it in whatever create/update
// payload it's already building.

export async function uploadIconImage(formData: FormData): Promise<{ url?: string; error?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return guard

  const file = formData.get('icon')
  if (!file || !(file instanceof File)) return { error: 'No file provided.' }
  if (file.size === 0) return { error: 'The file is empty.' }
  if (file.size > 5 * 1024 * 1024) return { error: 'File too large. Maximum size is 5 MB.' }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const allowed = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])
  if (!allowed.has(ext)) return { error: 'Only PNG, JPG, GIF, and WEBP files are allowed.' }

  // Buffer-level check: this bucket is public — confirm the bytes actually
  // match the declared/extension-implied image type before publishing them.
  const magicByteCheck = await validateAttachment(file)
  if (!magicByteCheck.valid) return { error: magicByteCheck.error ?? 'File content does not match its declared type.' }

  const admin = createAdminClient()
  const storagePath = `${crypto.randomUUID()}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: storageError } = await admin.storage
    .from('icons')
    .upload(storagePath, buffer, { contentType: file.type, upsert: false })

  if (storageError) return { error: 'Upload failed. Please try again.' }

  const { data: { publicUrl } } = admin.storage.from('icons').getPublicUrl(storagePath)

  return { url: publicUrl }
}
