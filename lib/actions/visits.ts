'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { applyStoreAnswer } from '@/lib/visits/confirm'
import { visitCodeFor } from '@/lib/visits/code'
import { clip, PO_STATUS_LABEL, type PoStatus } from '@/lib/visits/constants'
import { logAdminAudit } from './admin/audit'

// Actions of the AC visit pages. The store confirms its own ACs; technicians / managers / admins record the PO and can mark a wrong report; an administrator sets
// the hours. Every action checks the person itself; nothing here is reachable by a plain user except answering for their own store.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }
type Result = { error?: string; message?: string }
const STAFF = ['agent', 'manager', 'admin', 'platform_owner']

async function storeOf(profileStoreId: string | null, orgId: string): Promise<string | null> {
  if (!profileStoreId) return null
  const admin = createAdminClient() as unknown as AnyClient
  const { data } = await admin.from('stores').select('code').eq('id', profileStoreId).eq('org_id', orgId).maybeSingle()
  return data?.code ? String(data.code).toUpperCase() : null
}

/** The store's answer for one AC: resolved or not resolved, with remarks. */
export async function confirmVisit(itemId: string, decision: string, remarks: string): Promise<Result> {
  const profile = await getCurrentProfile()
  if (!profile?.org_id) return { error: 'Not signed in.' }
  if (decision !== 'resolved' && decision !== 'not_resolved') return { error: 'Choose Resolved or Not resolved.' }
  const storeCode = await storeOf(profile.store_id ?? null, profile.org_id)
  if (!storeCode) return { error: 'Only a store login can answer for its ACs.' }

  const admin = createAdminClient()
  const { data: item } = await (admin as unknown as AnyClient).from('ac_visit_items').select('id, store_code, org_id').eq('id', itemId).maybeSingle()
  if (!item || item.org_id !== profile.org_id || String(item.store_code).toUpperCase() !== storeCode) return { error: 'This report is not for your store.' }

  const r = await applyStoreAnswer(admin, { itemId, decision, remarks, actor: { id: profile.id, fullName: profile.full_name } })
  if (!r.ok) return { error: r.error }
  revalidatePath('/ac-visits')
  if (decision === 'resolved') return { message: r.resolvedTickets > 0 ? `Thank you. ${r.resolvedTickets} ticket${r.resolvedTickets > 1 ? 's are' : ' is'} resolved.` : 'Thank you. The tickets were already resolved.' }
  return { message: r.oemMailed ? 'Thank you. The OEM has been asked to send an engineer again.' : 'Thank you. The technician has been told that it is not resolved.' }
}

/** Technician: the OEM's own parts list, and the PO number / date / vendor and progress. */
export async function savePartsPo(itemId: string, f: { oemPartsNote: string; poNumber: string; poDate: string; poVendor: string; poStatus: string }): Promise<Result> {
  const profile = await getCurrentProfile()
  if (!profile?.org_id || !STAFF.includes(profile.role)) return { error: 'Only a technician, manager or admin can do this.' }
  if (!['to_raise', 'raised', 'revisit_planned', 'done'].includes(f.poStatus)) return { error: 'Choose the progress of the PO.' }
  const poNumber = clip(f.poNumber, 60)
  if ((f.poStatus === 'raised' || f.poStatus === 'revisit_planned' || f.poStatus === 'done') && !poNumber) return { error: 'Please enter the PO number.' }
  if (f.poDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.poDate)) return { error: 'The PO date is not valid.' }
  const admin = createAdminClient() as unknown as AnyClient
  const { data: item } = await admin.from('ac_visit_items').select('id, org_id, ckdesk_no, store_code, request_ids, po_status, parts').eq('id', itemId).maybeSingle()
  if (!item || item.org_id !== profile.org_id) return { error: 'This item was not found.' }
  const { error } = await admin.from('ac_visit_items').update({
    oem_parts_note: clip(f.oemPartsNote, 1500) || null, po_number: poNumber || null, po_date: f.poDate || null, po_vendor: clip(f.poVendor, 100) || null,
    po_status: f.poStatus, po_updated_by: profile.id, po_updated_at: new Date().toISOString(),
  }).eq('id', itemId)
  if (error) return { error: 'Could not save.' }
  if (item.po_status !== f.poStatus) {
    const text = `Parts / PO for AC ${item.ckdesk_no}: ${PO_STATUS_LABEL[f.poStatus as PoStatus]}${poNumber ? ` (PO ${poNumber}${f.poDate ? `, ${f.poDate}` : ''}${f.poVendor ? `, ${clip(f.poVendor, 100)}` : ''})` : ''}.`
    for (const id of item.request_ids as string[]) await admin.from('request_comments').insert({ request_id: id, author_id: profile.id, body: text, is_internal: f.poStatus === 'to_raise' })
  }
  revalidatePath('/visits')
  return { message: 'Saved.' }
}

/** Technician: a report that is wrong (wrong store, not a real visit). Its unanswered items are cancelled; tickets already resolved stay resolved. */
export async function voidVisitReport(reportId: string, reason: string): Promise<Result> {
  const profile = await getCurrentProfile()
  if (!profile?.org_id || !STAFF.includes(profile.role)) return { error: 'Only a technician, manager or admin can do this.' }
  const why = clip(reason, 300)
  if (why.length < 3) return { error: 'Please write why the report is wrong.' }
  const admin = createAdminClient() as unknown as AnyClient
  const { data: report } = await admin.from('ac_visit_reports').select('id, org_id, engineer_name').eq('id', reportId).maybeSingle()
  if (!report || report.org_id !== profile.org_id) return { error: 'This report was not found.' }
  await admin.from('ac_visit_reports').update({ is_void: true, void_reason: why, voided_by: profile.id, voided_at: new Date().toISOString() }).eq('id', reportId)
  const { data: items } = await admin.from('ac_visit_items').update({ outcome: 'void', auto_resolve_at: null }).eq('report_id', reportId).in('outcome', ['pending_store', 'open', 'disputed']).select('request_ids')
  for (const it of (items ?? []) as { request_ids: string[] }[]) {
    for (const id of it.request_ids) await admin.from('request_comments').insert({ request_id: id, author_id: profile.id, body: `The visit report of engineer ${report.engineer_name} was marked wrong: ${why}`, is_internal: true })
  }
  await logAdminAudit({ orgId: profile.org_id, actorId: profile.id, entityType: 'ac_visit_report', entityId: reportId, action: 'ac_visit_report.voided', metadata: { reason: why } })
  revalidatePath('/visits')
  return { message: 'The report was marked wrong.' }
}

/** Administrator: the hours before an unanswered "resolved" resolves by itself, and before the store is reminded. */
export async function saveVisitSettings(autoResolveHours: number, reminderHours: number): Promise<Result> {
  const profile = await getCurrentProfile()
  if (!profile?.org_id || !['admin', 'platform_owner'].includes(profile.role)) return { error: 'Administrator role required.' }
  const a = Math.round(Number(autoResolveHours)), r = Math.round(Number(reminderHours))
  if (!Number.isFinite(a) || a < 1 || a > 720 || !Number.isFinite(r) || r < 1 || r > 720) return { error: 'Enter whole hours from 1 to 720.' }
  if (r >= a) return { error: 'The reminder must come before the automatic resolution.' }
  const admin = createAdminClient() as unknown as AnyClient
  const { error } = await admin.from('ac_visit_settings').upsert({ org_id: profile.org_id, auto_resolve_hours: a, reminder_hours: r, updated_at: new Date().toISOString(), updated_by: profile.id }, { onConflict: 'org_id' })
  if (error) return { error: 'Could not save.' }
  await logAdminAudit({ orgId: profile.org_id, actorId: profile.id, entityType: 'ac_visit_settings', entityId: null, action: 'ac_visit_settings.saved', metadata: { autoResolveHours: a, reminderHours: r } })
  revalidatePath('/visits')
  return { message: 'Saved.' }
}

/** Technician / manager / admin: today's visit code of any store of the organisation (for a store that cannot be reached). */
export async function lookupVisitCode(storeCode: string): Promise<Result & { code?: string }> {
  const profile = await getCurrentProfile()
  if (!profile?.org_id || !STAFF.includes(profile.role)) return { error: 'Only a technician, manager or admin can do this.' }
  const code = String(storeCode ?? '').trim().toUpperCase()
  const admin = createAdminClient() as unknown as AnyClient
  const { data } = await admin.from('stores').select('code').eq('org_id', profile.org_id).eq('code', code).maybeSingle()
  if (!data) return { error: 'No store with this code.' }
  const v = visitCodeFor(profile.org_id, code)
  return v ? { code: v } : { error: 'The visit code is not switched on on this server.' }
}
