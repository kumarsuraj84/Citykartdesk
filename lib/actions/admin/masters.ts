'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { sanitizeTemplateHtml } from '@/lib/email/sanitize-template'
import { logAdminAudit } from './audit'
import { spreadsheetIdFrom } from '@/lib/masters/google'

// Administrator actions for the sheet masters (AC, Genset, CVM). Every action checks the role itself; nothing here is reachable by a plain user.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }
type ActionResult = { error?: string }
const KINDS = ['ac', 'genset', 'cvm', 'pms'] as const
const MAIL_KINDS = ['ac', 'genset'] as const

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' as const }
  if (!['admin', 'platform_owner'].includes(profile.role)) return { error: 'Administrator role required.' as const }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' as const }
  return { profile, orgId: profile.org_id as string }
}

/** Saves which Google Sheet is the AC / Genset / CVM master. The link or the plain sheet id can be pasted. */
export async function saveMasterSource(kind: string, linkOrId: string, tabName: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  if (!(KINDS as readonly string[]).includes(kind)) return { error: 'Unknown sheet.' }
  const id = spreadsheetIdFrom(linkOrId)
  if (!id) return { error: 'That does not look like a Google Sheet link. Paste the address of the sheet (docs.google.com/spreadsheets/d/...).' }
  const tab = tabName.trim().slice(0, 100) || null
  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('master_sources').upsert(
    { org_id: guard.orgId, kind, spreadsheet_id: id, tab_name: tab, content_hash: null, last_status: null, last_error: null },
    { onConflict: 'org_id,kind' },
  )
  if (error) return { error: 'Could not save the sheet.' }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'master_source', entityId: kind, action: 'master_source.saved', metadata: { kind, tab } })
  revalidatePath('/admin/masters')
  return {}
}

export async function saveMasterTemplate(kind: string, subject: string, bodyHtml: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  if (!(MAIL_KINDS as readonly string[]).includes(kind)) return { error: 'Unknown template.' }
  const cleanSubject = subject.trim().slice(0, 300)
  const cleanBody = sanitizeTemplateHtml(bodyHtml).trim()
  if (!cleanSubject || !cleanBody) return { error: 'The subject and the message are both needed.' }
  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('master_mail_templates').upsert(
    { org_id: guard.orgId, kind, subject: cleanSubject, body_html: cleanBody, updated_at: new Date().toISOString(), updated_by: guard.profile.id },
    { onConflict: 'org_id,kind' },
  )
  if (error) return { error: 'Could not save the template.' }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'master_mail_template', entityId: kind, action: 'master_template.saved', metadata: { kind } })
  revalidatePath('/admin/masters')
  return {}
}

/** Copies the sheets (AC, Genset, CVM, AC PMS) into CK Desk right now (otherwise it happens at 11:00, 15:00 and 19:00). Administrator only; refuses a second run within 30 seconds. */
export async function updateMastersNow(): Promise<ActionResult & { summary?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const admin = createAdminClient() as unknown as AnyClient
  const { data: recent } = await admin.from('master_sources').select('last_checked_at').eq('org_id', guard.orgId).order('last_checked_at', { ascending: false, nullsFirst: false }).limit(1)
  const last = recent?.[0]?.last_checked_at ? new Date(recent[0].last_checked_at).getTime() : 0
  if (Date.now() - last < 30_000) return { error: 'The sheets were just updated. Please wait a moment.' }
  const { runMastersSyncForOrg } = await import('@/lib/masters/run')
  const report = await runMastersSyncForOrg(guard.orgId, { force: true })
  revalidatePath('/admin/masters')
  if ('error' in report) return { error: report.error === 'not connected' ? 'Google Sheets is not connected yet.' : report.error }
  const failed = (['ac', 'genset', 'cvm', 'pms'] as const).filter((k) => report[k].status === 'error')
  if (failed.length) return { error: 'Could not read the ' + failed.map((k) => (k === 'ac' ? 'AC' : k === 'genset' ? 'Genset' : k === 'pms' ? 'AC PMS' : 'CVM')).join(', ') + ' sheet. Details are below.' }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'master_sources', entityId: null, action: 'master_sources.updated_now' })
  return { summary: 'The sheets are up to date.' }
}

/** Goes back to the built-in wording for a template. */
export async function resetMasterTemplate(kind: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  if (!(MAIL_KINDS as readonly string[]).includes(kind)) return { error: 'Unknown template.' }
  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('master_mail_templates').delete().eq('org_id', guard.orgId).eq('kind', kind)
  if (error) return { error: 'Could not reset the template.' }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'master_mail_template', entityId: kind, action: 'master_template.reset', metadata: { kind } })
  revalidatePath('/admin/masters')
  return {}
}

/** Stops reading the sheets: forgets the saved Google connection (the copies already in CK Desk stay). */
export async function disconnectGoogleSheets(): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('master_google_connection').delete().eq('org_id', guard.orgId)
  if (error) return { error: 'Could not disconnect.' }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'master_google_connection', entityId: null, action: 'master_google.disconnected' })
  revalidatePath('/admin/masters')
  return {}
}
