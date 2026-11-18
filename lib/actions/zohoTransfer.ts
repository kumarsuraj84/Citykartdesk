'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { loadCkCatalogue } from '@/lib/zoho/transfer/data'
import { CK_STATUSES } from '@/lib/zoho/transfer/suggest'
import { logAdminAudit } from './admin/audit'

// Saves the Zoho -> CK Desk MAPPING (stage 1). Nothing here creates, changes or moves a ticket, and nothing is ever written to Zoho.
// Administrators only: the Zoho tab is open to managers to LOOK, but the mapping is changed by an administrator.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }
type ActionResult = { error?: string; saved?: number }

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' as const }
  if (!['admin', 'platform_owner'].includes(profile.role)) return { error: 'Administrator role required.' as const }
  if (!profile.org_id) return { error: 'Your account is not linked to an organisation.' as const }
  return { profile, orgId: profile.org_id as string }
}
const db = () => createAdminClient() as unknown as AnyClient
const clip = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max)

export type TemplateMappingInput = {
  zohoTemplate: string
  formTemplateId: string | null
  services: { category: string; serviceId: string | null }[]
  categories: { category: string; subcategory: string; categoryId: string | null }[]
  items: { category: string; subcategory: string; item: string; subCategoryId: string | null }[]
  fields: { zohoField: string; ckFieldId: string | null }[]
}

/** Everything the administrator chose for ONE Zoho template, replacing what was saved for that template before. */
export async function saveTemplateMapping(input: TemplateMappingInput): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const { orgId, profile } = guard
  const template = clip(input.zohoTemplate)
  if (input.zohoTemplate === undefined) return { error: 'Choose a Zoho template first.' }

  const cat = await loadCkCatalogue(orgId)
  const serviceIds = new Set(cat.services.map((s) => s.id))
  const categoryIds = new Set(cat.services.flatMap((s) => s.subCategories.map((x) => x.categoryId)))
  const subCategoryIds = new Set(cat.services.flatMap((s) => s.subCategories.map((x) => x.id)))
  const tpl = input.formTemplateId ? cat.templates.find((t) => t.id === input.formTemplateId) : null
  if (input.formTemplateId && !tpl) return { error: 'That CK Desk form template was not found.' }
  const fieldIds = new Set((tpl?.fields ?? []).map((f) => f.id))

  const services = input.services.filter((r) => r.serviceId)
  const categories = input.categories.filter((r) => r.categoryId)
  const items = input.items.filter((r) => r.subCategoryId)
  const fields = input.fields.filter((r) => r.ckFieldId)
  if (services.some((r) => !serviceIds.has(r.serviceId!))) return { error: 'One of the chosen CK Desk services was not found.' }
  if (categories.some((r) => !categoryIds.has(r.categoryId!))) return { error: 'One of the chosen CK Desk categories was not found.' }
  if (items.some((r) => !subCategoryIds.has(r.subCategoryId!))) return { error: 'One of the chosen CK Desk sub-categories was not found.' }
  if (fields.some((r) => !fieldIds.has(r.ckFieldId!))) return { error: 'One of the chosen CK Desk fields is not on the mapped form template.' }

  const d = db()
  const now = new Date().toISOString()
  // replace this template's rows: delete, then insert what is chosen (a row left blank means "not mapped")
  for (const t of ['zoho_map_templates', 'zoho_map_services', 'zoho_map_categories', 'zoho_map_items', 'zoho_map_fields']) {
    const { error } = await d.from(t).delete().eq('org_id', orgId).eq('zoho_template', template)
    if (error) return { error: 'Could not save the mapping.' }
  }
  const ins = async (table: string, rows: Record<string, unknown>[]) => (rows.length ? (await d.from(table).insert(rows)).error : null)
  const errs = await Promise.all([
    input.formTemplateId ? ins('zoho_map_templates', [{ org_id: orgId, zoho_template: template, form_template_id: input.formTemplateId, updated_by: profile.id, updated_at: now }]) : null,
    ins('zoho_map_services', services.map((r) => ({ org_id: orgId, zoho_template: template, zoho_category: clip(r.category), service_id: r.serviceId, updated_by: profile.id, updated_at: now }))),
    ins('zoho_map_categories', categories.map((r) => ({ org_id: orgId, zoho_template: template, zoho_category: clip(r.category), zoho_subcategory: clip(r.subcategory), category_id: r.categoryId, updated_at: now }))),
    ins('zoho_map_items', items.map((r) => ({ org_id: orgId, zoho_template: template, zoho_category: clip(r.category), zoho_subcategory: clip(r.subcategory), zoho_item: clip(r.item), sub_category_id: r.subCategoryId, updated_at: now }))),
    ins('zoho_map_fields', fields.map((r) => ({ org_id: orgId, zoho_template: template, zoho_field: clip(r.zohoField), ck_field_id: r.ckFieldId, updated_at: now }))),
  ])
  if (errs.some(Boolean)) return { error: 'Part of the mapping could not be saved. Open the page again and check what is shown.' }
  await logAdminAudit({
    orgId, actorId: profile.id, entityType: 'zoho_mapping', entityId: profile.id, action: 'zoho_mapping.template_saved',
    metadata: { template, formTemplate: !!input.formTemplateId, services: services.length, categories: categories.length, items: items.length, fields: fields.length },
  })
  revalidatePath('/zoho/mapping')
  revalidatePath('/zoho/move')
  return { saved: services.length + categories.length + items.length + fields.length + (input.formTemplateId ? 1 : 0) }
}

/** Zoho status -> CK Desk status, for the rows shown (a blank choice removes the mapping). */
export async function saveStatusMapping(rows: { zohoValue: string; ckValue: string | null }[]): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const allowed = new Set(CK_STATUSES.map((s) => s.value))
  if (rows.some((r) => r.ckValue && !allowed.has(r.ckValue))) return { error: 'One of the chosen CK Desk statuses is not valid.' }
  const d = db()
  const now = new Date().toISOString()
  const keep = rows.filter((r) => r.ckValue)
  const drop = rows.filter((r) => !r.ckValue).map((r) => String(r.zohoValue))
  if (drop.length) { const { error } = await d.from('zoho_map_values').delete().eq('org_id', guard.orgId).eq('kind', 'status').in('zoho_value', drop); if (error) return { error: 'Could not save the statuses.' } }
  if (keep.length) {
    const { error } = await d.from('zoho_map_values').upsert(keep.map((r) => ({ org_id: guard.orgId, kind: 'status', zoho_value: String(r.zohoValue), ck_value: r.ckValue, updated_at: now })), { onConflict: 'org_id,kind,zoho_value' })
    if (error) return { error: 'Could not save the statuses.' }
  }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'zoho_mapping', entityId: guard.profile.id, action: 'zoho_mapping.statuses_saved', metadata: { saved: keep.length, removed: drop.length } })
  revalidatePath('/zoho/mapping')
  revalidatePath('/zoho/move')
  return { saved: keep.length }
}

/** One Zoho person matched by hand to a CK Desk person (a blank profile removes it). */
export async function savePersonMapping(input: { kind: 'requester' | 'technician'; zohoKey: string; zohoName: string | null; profileId: string | null }): Promise<ActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  if (input.kind !== 'requester' && input.kind !== 'technician') return { error: 'Unknown kind of person.' }
  const zohoKey = clip(input.zohoKey).toLowerCase()
  if (!zohoKey) return { error: 'The Zoho person has no name or e-mail to match on.' }
  const d = db()
  if (!input.profileId) {
    await d.from('zoho_map_people').delete().eq('org_id', guard.orgId).eq('kind', input.kind).eq('zoho_key', zohoKey)
  } else {
    const { data: p } = await d.from('profiles').select('id').eq('org_id', guard.orgId).eq('id', input.profileId).maybeSingle()
    if (!p) return { error: 'That CK Desk person was not found in your organisation.' }
    const { error } = await d.from('zoho_map_people').upsert({ org_id: guard.orgId, kind: input.kind, zoho_key: zohoKey, zoho_name: clip(input.zohoName) || null, profile_id: input.profileId, updated_at: new Date().toISOString() }, { onConflict: 'org_id,kind,zoho_key' })
    if (error) return { error: 'Could not save this match.' }
  }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'zoho_mapping', entityId: guard.profile.id, action: 'zoho_mapping.person_saved', metadata: { kind: input.kind, matched: !!input.profileId } })
  revalidatePath('/zoho/mapping')
  revalidatePath('/zoho/move')
  return { saved: input.profileId ? 1 : 0 }
}

export type MoveActionResult = { error?: string; results?: import('@/lib/zoho/transfer/move').MoveResult[] }

/**
 * STAGE 2: moves the chosen Zoho tickets into CK Desk, silently (no mail, WhatsApp, push or survey), a few at a time.
 * Administrators only. Everything is read and checked again on the server; the screen's preview is never trusted.
 */
export async function moveZohoTicketsAction(numbers: number[]): Promise<MoveActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const { moveZohoTickets, MOVE_BATCH_LIMIT } = await import('@/lib/zoho/transfer/move')
  const clean = [...new Set((Array.isArray(numbers) ? numbers : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))]
  if (clean.length === 0) return { error: 'Choose at least one ticket.' }
  if (clean.length > MOVE_BATCH_LIMIT) return { error: `Move at most ${MOVE_BATCH_LIMIT} tickets at a time.` }
  const results = await moveZohoTickets({ orgId: guard.orgId, actorId: guard.profile.id, numbers: clean })
  const ok = results.filter((r) => r.ok)
  await logAdminAudit({
    orgId: guard.orgId, actorId: guard.profile.id, entityType: 'zoho_transfer', entityId: guard.profile.id, action: 'zoho_transfer.moved',
    metadata: { asked: clean.length, moved: ok.length, failed: results.length - ok.length, numbers: ok.map((r) => r.requestNo) },
  })
  revalidatePath('/zoho/move')
  revalidatePath('/requests')
  return { results }
}

export type RefreshActionResult = { error?: string; results?: import('@/lib/zoho/transfer/refresh').RefreshResult[] }

/**
 * Fills in EMPTY CK Desk fields of tickets that were already moved, using the mapping as it is now (for example a contact number mapped after the move).
 * A value already on the ticket is never overwritten; nothing else on the ticket changes; nobody is notified. Administrators only.
 */
export async function refreshMovedFieldsAction(numbers: number[]): Promise<RefreshActionResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const { refreshMovedFields, REFRESH_BATCH_LIMIT } = await import('@/lib/zoho/transfer/refresh')
  const clean = [...new Set((Array.isArray(numbers) ? numbers : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))]
  if (clean.length === 0) return { error: 'Type at least one Zoho ticket number.' }
  if (clean.length > REFRESH_BATCH_LIMIT) return { error: `Fill in at most ${REFRESH_BATCH_LIMIT} tickets at a time.` }
  const results = await refreshMovedFields({ orgId: guard.orgId, actorId: guard.profile.id, numbers: clean })
  const changed = results.filter((r) => r.ok && r.filled.length > 0)
  await logAdminAudit({
    orgId: guard.orgId, actorId: guard.profile.id, entityType: 'zoho_transfer', entityId: guard.profile.id, action: 'zoho_transfer.fields_filled',
    metadata: { asked: clean.length, changed: changed.length, numbers: changed.map((r) => r.requestNo) },
  })
  revalidatePath('/requests')
  return { results }
}

export type ApprovalPreviewResult = { error?: string; targets?: import('@/lib/zoho/transfer/approvals').ApprovalTarget[] }
export type ApprovalSendResult = { error?: string; results?: import('@/lib/zoho/transfer/approvals').SendApprovalResult[] }

/** Which moved tickets are waiting for approval and who Zoho sent the approval to (read only). Leave `numbers` empty to see all of them. Administrators only. */
export async function previewMovedApprovalsAction(numbers: number[]): Promise<ApprovalPreviewResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const { previewMovedApprovals } = await import('@/lib/zoho/transfer/approvals')
  const clean = [...new Set((Array.isArray(numbers) ? numbers : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 200)
  return { targets: await previewMovedApprovals(guard.orgId, clean.length ? clean : undefined) }
}

/**
 * Creates the CK Desk approval, and tells only the approver, for the chosen moved tickets that are waiting for approval. Administrators only; the ticket numbers must be named
 * (no "send all" in one press: a handful at a time). Everything is re-read and re-checked here.
 */
export async function sendMovedApprovalsAction(numbers: number[]): Promise<ApprovalSendResult> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const { sendMovedApprovals, APPROVAL_BATCH_LIMIT } = await import('@/lib/zoho/transfer/approvals')
  const clean = [...new Set((Array.isArray(numbers) ? numbers : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))]
  if (clean.length === 0) return { error: 'Type the Zoho ticket numbers to send.' }
  if (clean.length > APPROVAL_BATCH_LIMIT) return { error: `Send at most ${APPROVAL_BATCH_LIMIT} tickets at a time.` }
  const results = await sendMovedApprovals({ orgId: guard.orgId, actorId: guard.profile.id, actorName: guard.profile.full_name ?? 'An administrator', numbers: clean })
  const ok = results.filter((r) => r.ok)
  await logAdminAudit({
    orgId: guard.orgId, actorId: guard.profile.id, entityType: 'zoho_transfer', entityId: guard.profile.id, action: 'zoho_transfer.approvals_sent',
    metadata: { asked: clean.length, sent: ok.length, failed: results.length - ok.length, numbers: ok.map((r) => r.requestNo) },
  })
  revalidatePath('/requests')
  return { results }
}

// ── STAGE 3: move everything that matches the filters, in chunks, with a record ─────────────────────────────────────────────

type RunFilters = import('@/lib/zoho/transfer/data').MoveFilters
const cleanFilters = (f: RunFilters): RunFilters => {
  const s = (v: unknown, n = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined)
  return {
    numbers: s(f?.numbers, 2000), status: s(f?.status), template: s(f?.template), category: s(f?.category), technician: s(f?.technician), requester: s(f?.requester),
    from: s(f?.from, 10), to: s(f?.to, 10), moved: f?.moved === 'not' || f?.moved === 'only' ? f.moved : undefined,
  }
}

/** Reads every matching Zoho ticket and says what a run would do (nothing is moved). */
export async function prepareMoveRunAction(filters: RunFilters): Promise<{ error?: string; prepared?: import('@/lib/zoho/transfer/batch').RunPrepared }> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  try {
    const { prepareRun } = await import('@/lib/zoho/transfer/batch')
    return { prepared: await prepareRun(guard.orgId, { ...cleanFilters(filters), moved: 'not' }) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not read the Zoho tickets.' }
  }
}

export async function startMoveRunAction(filters: RunFilters, asked: number): Promise<{ error?: string; runId?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const { startRun } = await import('@/lib/zoho/transfer/batch')
  const runId = await startRun(guard.orgId, guard.profile.id, cleanFilters(filters), Math.max(0, Math.floor(Number(asked) || 0)))
  return runId ? { runId } : { error: 'Could not start the run.' }
}

/** One chunk (up to 25) of a running run. The mover re-reads and re-checks every ticket; the run record only counts. */
export async function moveRunChunkAction(runId: string, numbers: number[]): Promise<MoveActionResult & { runStopped?: boolean }> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const { moveZohoTickets, MOVE_BATCH_LIMIT } = await import('@/lib/zoho/transfer/move')
  const { addToRun } = await import('@/lib/zoho/transfer/batch')
  const clean = [...new Set((Array.isArray(numbers) ? numbers : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, MOVE_BATCH_LIMIT)
  if (clean.length === 0) return { error: 'No tickets in this chunk.' }
  const results = await moveZohoTickets({ orgId: guard.orgId, actorId: guard.profile.id, numbers: clean })
  const failures = results.filter((r) => !r.ok).map((r) => ({ no: r.zohoNo, reason: r.reason ?? 'Not moved.' }))
  const counted = await addToRun(guard.orgId, runId, results.filter((r) => r.ok).length, failures)
  if (!counted) return { results, runStopped: true }
  return { results }
}

export async function finishMoveRunAction(runId: string, stopped: boolean): Promise<{ error?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const { finishRun } = await import('@/lib/zoho/transfer/batch')
  await finishRun(guard.orgId, runId, !!stopped)
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'zoho_transfer', entityId: runId, action: stopped ? 'zoho_transfer.run_stopped' : 'zoho_transfer.run_finished', metadata: { runId } })
  revalidatePath('/zoho/move')
  revalidatePath('/requests')
  return {}
}

/** Switch tickets moved from Zoho ON or OFF for alerts, reminders and scheduled rules (default OFF = silent). */
export async function setMovedActiveAction(active: boolean): Promise<{ error?: string }> {
  const guard = await requireAdmin()
  if ('error' in guard) return { error: guard.error }
  const { MOVED_ACTIVE_SETTING } = await import('@/lib/zoho/transfer/silent')
  const { error } = await db().from('app_settings').upsert({ key: MOVED_ACTIVE_SETTING, value: active ? 'true' : 'false' }, { onConflict: 'key' })
  if (error) return { error: 'Could not save the setting.' }
  await logAdminAudit({ orgId: guard.orgId, actorId: guard.profile.id, entityType: 'zoho_transfer', entityId: guard.profile.id, action: active ? 'zoho_transfer.moved_tickets_switched_on' : 'zoho_transfer.moved_tickets_switched_off', metadata: { active } })
  revalidatePath('/zoho/move')
  return {}
}
