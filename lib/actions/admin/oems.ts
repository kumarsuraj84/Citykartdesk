'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { logAdminAudit } from './audit'
import { planStoreAssignment } from '@/lib/oems/store-assignment'
import { isOemKind, STORE_OEM_COLUMN, OEM_KIND_LABEL, type OemKind } from '@/lib/oems/kinds'
import { isHtmlTemplate } from '@/lib/email/oem-template'
import { sanitizeTemplateHtml } from '@/lib/email/sanitize-template'
import type { Database } from '@/types/database'
import { inBatchesDo } from '@/lib/queries/in-batches'
import { sanitizeError } from '@/lib/observability/sanitize-error'
import { recordAudit } from '@/lib/syslog/audit'
import { resetCcBookCache } from '@/lib/requests/cc-recipients'

type ActionResult<T = undefined> = { error?: string; data?: T }
type OemUpdate = Database['public']['Tables']['oems']['Update']
type StoreUpdate = Database['public']['Tables']['stores']['Update']

async function requireAdminOrManager() {
  const profile = await getCurrentProfile()
  if (!profile) return { error: 'Not authenticated.' }
  if (!['admin', 'manager', 'platform_owner'].includes(profile.role)) return { error: 'Admin or manager role required.' }
  return { profile }
}

// ── OEMs (vendors) ────────────────────────────────────────────────────────────
// Each OEM carries its own recipient email list and a customizable
// notification email template — see runOemAutoRouting() in
// lib/actions/requests.ts for how these get used when an AC-style ticket is
// raised by a store assigned to this OEM (stores.oem_id).

export type OemInput = {
  name: string
  /** The type of OEM: 'ac' (default) or 'genset'. A store has one slot per type, so the same store can have one AC OEM and one Genset OEM. */
  kind?: OemKind
  emails: string[]
  email_subject_template?: string | null
  email_body_template?: string | null
  is_active?: boolean
}

// A body saved from the rich editor is HTML and gets sanitized; a plain-text body is kept as typed.
function cleanBodyTemplate(body: string | null | undefined): string | null {
  const trimmed = body?.trim()
  if (!trimmed) return null
  return isHtmlTemplate(trimmed) ? sanitizeTemplateHtml(trimmed) : trimmed
}

function cleanEmails(emails: string[]): string[] {
  return [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
}

export async function createOem(fields: OemInput): Promise<ActionResult<{ id: string }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  if (!fields.name.trim()) return { error: 'OEM name is required.' }
  if (fields.kind !== undefined && !isOemKind(fields.kind)) return { error: 'OEM type must be AC or Genset.' }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('oems')
    .insert({
      org_id: guard.profile!.org_id!,
      name: fields.name.trim(),
      kind: fields.kind ?? 'ac',
      emails: cleanEmails(fields.emails),
      email_subject_template: fields.email_subject_template?.trim() || null,
      email_body_template: cleanBodyTemplate(fields.email_body_template),
      is_active: fields.is_active ?? true,
    })
    .select('id')
    .single()

  if (error) return { error: sanitizeError(error, { route: 'lib/actions/admin/oems.ts' }) }
  if (cleanEmails(fields.emails).length > 0) {
    await recordAudit({ category: 'security', action: 'oem.contacts_changed', entityType: 'oem', entityLabel: fields.name, after: { emails: cleanEmails(fields.emails) }, actorId: guard.profile!.id, orgId: guard.profile!.org_id ?? undefined })
    resetCcBookCache()
  }
  // D-12: '/admin/oems' isn't a real route — the OEM admin UI lives on the
  // OEM tab of '/admin/org' (OrgStructureClient.tsx). deleteOem() below
  // already revalidated the right path; create/update didn't, so an edit
  // stayed stale on screen until a hard refresh.
  revalidatePath('/admin/org')
  return { data }
}

export async function updateOem(id: string, fields: Partial<OemInput>): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  const update: OemUpdate = {}
  if (fields.name !== undefined) update.name = fields.name.trim()
  if (fields.kind !== undefined) {
    if (!isOemKind(fields.kind)) return { error: 'OEM type must be AC or Genset.' }
    update.kind = fields.kind
  }
  if (fields.emails !== undefined) update.emails = cleanEmails(fields.emails)
  if ('email_subject_template' in fields) update.email_subject_template = fields.email_subject_template?.trim() || null
  if ('email_body_template' in fields) update.email_body_template = cleanBodyTemplate(fields.email_body_template)
  if (fields.is_active !== undefined) update.is_active = fields.is_active

  const before = update.emails !== undefined ? (await admin.from('oems').select('emails').eq('id', id).eq('org_id', guard.profile!.org_id!).maybeSingle()).data?.emails ?? null : null
  const { error } = await admin.from('oems').update(update).eq('id', id).eq('org_id', guard.profile!.org_id!)
  // 23514 = the database refused: an OEM that is mapped to stores cannot change type
  if (error?.code === '23514') return { error: 'Remove this OEM from its stores before changing its type.' }
  if (error) return { error: sanitizeError(error, { route: 'lib/actions/admin/oems.ts' }) }
  if (update.emails !== undefined) {
    await recordAudit({ category: 'security', action: 'oem.contacts_changed', entityType: 'oem', entityId: id, before: { emails: before }, after: { emails: update.emails }, actorId: guard.profile!.id, orgId: guard.profile!.org_id ?? undefined })
    resetCcBookCache()
  }
  revalidatePath('/admin/org')
  return {}
}

export async function deleteOem(id: string): Promise<ActionResult> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }

  const admin = createAdminClient()
  // Stores pointing at this OEM fall back to unmapped (no auto-email) rather
  // than blocking deletion — matches stores.oem_id's ON DELETE SET NULL.
  const { error } = await admin.from('oems').delete().eq('id', id).eq('org_id', guard.profile!.org_id!)
  if (error) return { error: sanitizeError(error, { route: 'lib/actions/admin/oems.ts' }) }
  revalidatePath('/admin/org')
  return {}
}

// ── Assign stores to an OEM (the reverse of picking an OEM on each store) ─────
// stores.oem_id is the single source of truth (one OEM per store), so this just
// applies the difference between the ticked list and what the OEM has now.
// Ticking a store that belongs to another OEM moves it.

export async function setOemStores(
  oemId: string,
  storeIds: string[],
): Promise<ActionResult<{ assigned: number; removed: number; moved: number; movedFrom: { store: string; from: string }[] }>> {
  const guard = await requireAdminOrManager()
  if (guard.error) return { error: guard.error }
  const orgId = guard.profile!.org_id
  if (!orgId) return { error: 'Your account is not linked to an organisation.' }
  if (!Array.isArray(storeIds) || storeIds.length > 5000) return { error: 'Invalid store list.' }

  const admin = createAdminClient()
  const { data: oem } = await admin.from('oems').select('id, name, kind').eq('id', oemId).eq('org_id', orgId).maybeSingle()
  if (!oem) return { error: 'OEM not found in your organisation.' }
  // The OEM's type decides which slot of the store is set: AC → the store's AC OEM, Genset → the store's Genset OEM. A store therefore keeps ONE OEM per type.
  const kind: OemKind = isOemKind(oem.kind) ? oem.kind : 'ac'
  const slot = STORE_OEM_COLUMN[kind]
  const slotPatch = (value: string | null): StoreUpdate => (kind === 'genset' ? { genset_oem_id: value } : { oem_id: value })

  // Only this organisation's stores can be touched, whatever ids were sent.
  const { data: stores, error: loadError } = await admin.from('stores').select('id, code, oem_id, genset_oem_id').eq('org_id', orgId)
  if (loadError) return { error: 'Could not load stores.' }

  const links = (stores ?? []).map((s) => ({ id: s.id, oem_id: s[slot] }))
  const plan = planStoreAssignment(links, storeIds, oemId)
  const { data: oemRows } = await admin.from('oems').select('id, name').eq('org_id', orgId)
  const oemName = new Map((oemRows ?? []).map((o) => [o.id, o.name]))
  const codeById = new Map((stores ?? []).map((s) => [s.id, s.code]))
  const movedFrom = plan.moved.slice(0, 50).map((m) => ({ store: codeById.get(m.storeId) ?? m.storeId, from: oemName.get(m.fromOemId) ?? 'another OEM' }))

  if (plan.toAssign.length > 0) {
    const { error } = await inBatchesDo(plan.toAssign, (batch) => admin.from('stores').update(slotPatch(oemId)).in('id', batch).eq('org_id', orgId))
    if (error) return { error: 'Could not assign the stores. Nothing further was changed.' }
  }
  if (plan.toUnassign.length > 0) {
    const { error } = await inBatchesDo(plan.toUnassign, (batch) => admin.from('stores').update(slotPatch(null)).in('id', batch).eq('org_id', orgId).eq(slot, oemId))
    if (error) return { error: 'Stores were assigned, but removing the unticked ones failed. Please try saving again.' }
  }

  await logAdminAudit({
    orgId, actorId: guard.profile!.id,
    entityType: 'oem', entityId: oemId, action: 'oem_stores_updated',
    metadata: { oem: oem.name, type: OEM_KIND_LABEL[kind], assigned: plan.toAssign.length, removed: plan.toUnassign.length, moved_from_other_oems: plan.moved.length, replaced: movedFrom },
  })

  revalidatePath('/admin/org')
  return { data: { assigned: plan.toAssign.length, removed: plan.toUnassign.length, moved: plan.moved.length, movedFrom } }
}
