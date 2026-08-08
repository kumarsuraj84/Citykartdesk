'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/queries/profiles'

type ActionResult = { error?: string }

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
}

export async function createKbArticle(
  title: string,
  content: string,
  status: string,
): Promise<{ error?: string; article?: unknown }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['manager', 'admin', 'platform_owner'].includes(profile.role)) {
    return { error: 'Only managers and admins can create articles.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createClient() as any

  const { data: org } = await supabase
    .from('organizations')
    .select('id')
    .limit(1)
    .single()
  if (!org) return { error: 'Could not determine organisation.' }

  const slug = slugify(title) || `article-${Date.now()}`

  const { data, error } = await supabase
    .from('kb_articles')
    .insert({
      org_id: org.id,
      title: title.trim(),
      slug,
      content,
      status: status as 'draft' | 'published' | 'archived',
      author_id: profile.id,
    })
    .select('id, title, slug, status, view_count, helpful_yes, helpful_no, created_at, updated_at, author:profiles(id, full_name)')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/admin/knowledge-base')
  return { article: data }
}

export async function getKbArticleContent(id: string): Promise<{ error?: string; content?: string }> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['manager', 'admin', 'platform_owner'].includes(profile.role)) {
    return { error: 'Only managers and admins can edit articles.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('kb_articles')
    .select('content')
    .eq('id', id)
    .single()

  if (error || !data) return { error: error?.message ?? 'Article not found.' }
  return { content: data.content ?? '' }
}

export async function updateKbArticle(
  id: string,
  title: string,
  content: string,
  status: string,
): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['manager', 'admin', 'platform_owner'].includes(profile.role)) {
    return { error: 'Only managers and admins can edit articles.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createClient() as any
  const { error } = await supabase
    .from('kb_articles')
    .update({
      title: title.trim(),
      content,
      status: status as 'draft' | 'published' | 'archived',
    })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/admin/knowledge-base')
  return {}
}

export async function archiveKbArticle(id: string): Promise<ActionResult> {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['manager', 'admin', 'platform_owner'].includes(profile.role)) {
    return { error: 'Only managers and admins can archive articles.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createClient() as any
  const { error } = await supabase
    .from('kb_articles')
    .update({ status: 'archived' })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/admin/knowledge-base')
  return {}
}
