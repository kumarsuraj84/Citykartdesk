'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { sanitizeTemplateHtml } from '@/lib/email/sanitize-template'
import { isHtmlTemplate, plainToHtml } from '@/lib/email/oem-template'
import { sendEmail } from '@/lib/email/send'
import { spreadsheetIdFrom } from '@/lib/masters/google'
import { renderMasterMail } from '@/lib/masters/mail'
import { allowedFields, programTemplate, PROGRAM_SAMPLE_VALUES, unknownFields } from '@/lib/programs/mail'
import { loadProgramEditor } from '@/lib/programs/admin-data'
import { PROGRAM_FIELDS, slugify, type ProgramColumns, type ProgramField, type ProgramRowType } from '@/lib/programs/types'
import { logAdminAudit } from './audit'

// Administrator actions for Vendor Programs (Admin -> Vendor Programs). Every action checks the role itself; nothing here is reachable by a plain user.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; auth?: any }
type ActionResult = { error?: string }

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' as const }
  if (!['admin', 'platform_owner'].includes(profile.role)) return { error: 'Administrator role required.' as const }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' as const }
  return { profile, orgId: profile.org_id as string }
}

const db = () => createAdminClient() as unknown as AnyClient
const touch = (guard: { profile: { id: string } }) => ({ updated_at: new Date().toISOString(), updated_by: guard.profile.id })

async function ownProgram(orgId: string, id: string) {
  const { data } = await db().from('vendor_programs').select('id, name, is_active, row_type').eq('org_id', orgId).eq('id', id).maybeSingle()
  return data as { id: string; name: string; is_active: boolean; row_type: ProgramRowType } | null
}

/** A new program starts switched OFF, with the standard mail wording and no sheet. */
export async function createProgram(name: string, rowType: string): Promise<ActionResult & { id?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 80)
  if (clean.length < 2) return { error: 'Give the program a name (for example "RO Water Purifier").' }
  if (rowType !== 'store' && rowType !== 'machine') return { error: 'Choose one row per store or one row per machine.' }
  const base = slugify(clean) || 'program'
  let slug = base
  for (let n = 2; n < 50; n++) {
    const { data } = await db().from('vendor_programs').select('id').eq('org_id', guard.orgId).eq('slug', slug).maybeSingle()
    if (!data) break
    slug = `${base}-${n}`
  }
  const { data, error } = await db().from('vendor_programs').insert({ org_id: guard.orgId, name: clean, slug, row_type: rowType, is_active: false, level: 'mail', created_by: guard.profile.id, ...touch(guard) }).select('id').single()
  if (error || !data) return { error: 'Could not create the program.' }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'vendor_program', entityId: data.id, action: 'vendor_program.created', metadata: { name: clean, rowType } })
  revalidatePath('/admin/programs')
  return { id: data.id as string }
}

/** The name and the kind of row. The kind of row cannot change once a sheet has been copied (the rows would be read differently). */
export async function saveProgramBasics(id: string, name: string, rowType: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const prog = await ownProgram(guard.orgId, id)
  if (!prog) return { error: 'Program not found.' }
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 80)
  if (clean.length < 2) return { error: 'Give the program a name.' }
  if (rowType !== 'store' && rowType !== 'machine') return { error: 'Choose one row per store or one row per machine.' }
  if (rowType !== prog.row_type) {
    const { count } = await db().from('program_rows').select('id', { count: 'exact', head: true }).eq('program_id', id)
    if ((count ?? 0) > 0) return { error: 'The kind of row cannot be changed after the sheet has been copied. Create a new program if the sheet has a different shape.' }
  }
  const { error } = await db().from('vendor_programs').update({ name: clean, row_type: rowType, ...touch(guard) }).eq('id', id).eq('org_id', guard.orgId)
  if (error) return { error: 'Could not save.' }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'vendor_program', entityId: id, action: 'vendor_program.updated', metadata: { name: clean, rowType } })
  revalidatePath('/admin/programs'); revalidatePath(`/admin/programs/${id}`)
  return {}
}

/** The categories of the program (a category is in at most one program, and not one that already sends to the AC / Genset OEM or is the AC PMS category). */
export async function saveProgramCategories(id: string, categoryIds: string[]): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const prog = await ownProgram(guard.orgId, id)
  if (!prog) return { error: 'Program not found.' }
  const wanted = [...new Set(categoryIds)]
  const { data: cats } = await db().from('service_categories').select('id, name, program_id, auto_oem_kind, is_pms').eq('org_id', guard.orgId)
  const all = (cats ?? []) as { id: string; name: string; program_id: string | null; auto_oem_kind: string | null; is_pms: boolean }[]
  for (const cid of wanted) {
    const c = all.find((x) => x.id === cid)
    if (!c) return { error: 'One of the categories was not found.' }
    if (c.program_id && c.program_id !== id) return { error: `"${c.name}" already belongs to another program.` }
    if (c.auto_oem_kind) return { error: `"${c.name}" already sends to the ${c.auto_oem_kind === 'ac' ? 'AC' : 'Genset'} OEM. Switch that off in Admin > Categories first.` }
    if (c.is_pms) return { error: `"${c.name}" is the AC PMS category and cannot be in a program.` }
  }
  const current = all.filter((c) => c.program_id === id).map((c) => c.id)
  const remove = current.filter((c) => !wanted.includes(c))
  const add = wanted.filter((c) => !current.includes(c))
  if (remove.length) { const { error } = await db().from('service_categories').update({ program_id: null }).in('id', remove).eq('org_id', guard.orgId); if (error) return { error: 'Could not save the categories.' } }
  if (add.length) { const { error } = await db().from('service_categories').update({ program_id: id }).in('id', add).eq('org_id', guard.orgId); if (error) return { error: 'Could not save the categories.' } }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'vendor_program', entityId: id, action: 'vendor_program.categories_saved', metadata: { added: add.length, removed: remove.length } })
  revalidatePath('/admin/programs'); revalidatePath(`/admin/programs/${id}`)
  return {}
}

/** The Google Sheet (link or id, tab) and the heading names that differ from the usual ones. */
export async function saveProgramSheet(id: string, linkOrId: string, tabName: string, columns: ProgramColumns): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  if (!(await ownProgram(guard.orgId, id))) return { error: 'Program not found.' }
  const sheetId = spreadsheetIdFrom(linkOrId)
  if (!sheetId) return { error: 'That does not look like a Google Sheet link. Paste the address of the sheet (docs.google.com/spreadsheets/d/...).' }
  const clean: ProgramColumns = {}
  for (const f of PROGRAM_FIELDS) { const v = (columns?.[f as ProgramField] ?? '').trim().slice(0, 80); if (v) clean[f as ProgramField] = v }
  const { error } = await db().from('vendor_programs').update({
    spreadsheet_id: sheetId, tab_name: tabName.trim().slice(0, 100) || null, columns: clean, content_hash: null, last_status: null, last_error: null, ...touch(guard),
  }).eq('id', id).eq('org_id', guard.orgId)
  if (error) return { error: 'Could not save the sheet.' }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'vendor_program', entityId: id, action: 'vendor_program.sheet_saved' })
  revalidatePath(`/admin/programs/${id}`)
  return {}
}

/** The mail wording. A {{field}} that does not exist is refused, because it would go out empty. */
export async function saveProgramTemplate(id: string, subject: string, bodyHtml: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  if (!(await ownProgram(guard.orgId, id))) return { error: 'Program not found.' }
  const cleanSubject = subject.trim().slice(0, 300)
  const cleanBody = sanitizeTemplateHtml(bodyHtml).trim()
  if (!cleanSubject || !cleanBody) return { error: 'The subject and the message are both needed.' }
  const data = await loadProgramEditor(guard.orgId, id)
  const bad = unknownFields(`${cleanSubject} ${cleanBody}`, allowedFields(data?.extraHeadings ?? []))
  if (bad.length) return { error: `These fields do not exist and would go out empty: ${bad.map((f) => `{{${f}}}`).join(', ')}. Use the field buttons above the message.` }
  const { error } = await db().from('vendor_programs').update({ mail_subject: cleanSubject, mail_body_html: cleanBody, ...touch(guard) }).eq('id', id).eq('org_id', guard.orgId)
  if (error) return { error: 'Could not save the wording.' }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'vendor_program', entityId: id, action: 'vendor_program.template_saved' })
  revalidatePath(`/admin/programs/${id}`)
  return {}
}

export async function resetProgramTemplate(id: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  if (!(await ownProgram(guard.orgId, id))) return { error: 'Program not found.' }
  const { error } = await db().from('vendor_programs').update({ mail_subject: null, mail_body_html: null, ...touch(guard) }).eq('id', id).eq('org_id', guard.orgId)
  if (error) return { error: 'Could not reset the wording.' }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'vendor_program', entityId: id, action: 'vendor_program.template_reset' })
  revalidatePath(`/admin/programs/${id}`)
  return {}
}

/** Sends the program's mail, filled with example values, to the administrator who pressed the button and to nobody else. */
export async function sendProgramTestMail(id: string): Promise<ActionResult & { sentTo?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const prog = await ownProgram(guard.orgId, id)
  if (!prog) return { error: 'Program not found.' }
  const { data: full } = await db().from('vendor_programs').select('mail_subject, mail_body_html').eq('id', id).maybeSingle()
  const tpl = programTemplate(full ?? {})
  const { data: u } = await createAdminClient().auth.admin.getUserById(guard.profile.id)
  const to = u?.user?.email
  if (!to) return { error: 'Your account has no e-mail address.' }
  const rendered = renderMasterMail({ subject: tpl.subject, body: isHtmlTemplate(tpl.body) ? tpl.body : plainToHtml(tpl.body) }, { ...PROGRAM_SAMPLE_VALUES, program: prog.name })
  const sent = await sendEmail({ to, subject: `[TEST - not sent to the vendor] ${rendered.subject}`, html: rendered.html, text: rendered.text })
  if (sent.error) return { error: 'The test mail could not be sent.' }
  return { sentTo: to }
}

/** Copies this program's sheet now (otherwise it happens at 11:00, 15:00 and 19:00). */
export async function updateProgramNow(id: string): Promise<ActionResult & { summary?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  if (!(await ownProgram(guard.orgId, id))) return { error: 'Program not found.' }
  const { data: p } = await db().from('vendor_programs').select('spreadsheet_id, last_checked_at').eq('id', id).maybeSingle()
  if (!p?.spreadsheet_id) return { error: 'Save the Google Sheet link first.' }
  if (p.last_checked_at && Date.now() - new Date(p.last_checked_at).getTime() < 20_000) return { error: 'The sheet was just updated. Please wait a moment.' }
  const { runProgramSyncNow } = await import('@/lib/programs/run')
  const report = await runProgramSyncNow(guard.orgId, id)
  revalidatePath(`/admin/programs/${id}`); revalidatePath('/admin/programs')
  if ('error' in report) return { error: report.error }
  if (report.status === 'error') return { error: report.message ?? 'The sheet could not be read.' }
  return { summary: report.status === 'unchanged' ? 'The sheet is up to date (nothing changed).' : `The sheet is up to date: ${report.added ?? 0} added, ${report.changed ?? 0} changed, ${report.removed ?? 0} removed.` }
}

/** Switches the program on or off. Switching ON is refused while a blocking item of "Check my set-up" is red. */
export async function setProgramActive(id: string, on: boolean): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const prog = await ownProgram(guard.orgId, id)
  if (!prog) return { error: 'Program not found.' }
  if (on) {
    const data = await loadProgramEditor(guard.orgId, id)
    const red = (data?.readiness.items ?? []).filter((i) => !i.ok && i.blocking)
    if (red.length) return { error: `Not ready yet: ${red[0].text}` }
  }
  if (prog.is_active === on) return {}
  const { error } = await db().from('vendor_programs').update({ is_active: on, ...touch(guard) }).eq('id', id).eq('org_id', guard.orgId)
  if (error) return { error: 'Could not save.' }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'vendor_program', entityId: id, action: on ? 'vendor_program.switched_on' : 'vendor_program.switched_off', metadata: { name: prog.name } })
  revalidatePath('/admin/programs'); revalidatePath(`/admin/programs/${id}`)
  return {}
}

/** A program can be deleted only while no ticket has been mailed through it; otherwise switch it off. */
export async function deleteProgram(id: string): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const prog = await ownProgram(guard.orgId, id)
  if (!prog) return { error: 'Program not found.' }
  const { count } = await db().from('request_program_snapshots').select('request_id', { count: 'exact', head: true }).eq('program_id', id)
  if ((count ?? 0) > 0) return { error: 'Tickets have already been mailed through this program, so it cannot be deleted. Switch it off instead.' }
  await db().from('service_categories').update({ program_id: null }).eq('program_id', id).eq('org_id', guard.orgId)
  const { error } = await db().from('vendor_programs').delete().eq('id', id).eq('org_id', guard.orgId)
  if (error) return { error: 'Could not delete the program.' }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'vendor_program', entityId: id, action: 'vendor_program.deleted', metadata: { name: prog.name } })
  revalidatePath('/admin/programs')
  return {}
}
