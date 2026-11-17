import 'server-only'
/**
 * "Fill in the missing fields" of tickets that were ALREADY moved from Zoho.
 * Used when a field was mapped after the ticket was moved (for example the contact number).
 *  - only EMPTY CK Desk fields are filled: a value already on the ticket is never overwritten;
 *  - nothing else on the ticket changes (status, technician, SLA times, conversation, approvals stay exactly as they were);
 *  - no mail, WhatsApp, push or notification: this file never calls any of them;
 *  - one internal note is added to the conversation saying what was filled in;
 *  - Zoho is only read, never written to.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import { logger } from '@/lib/observability/logger'
import type { FormField } from '@/types'
import { loadSavedMapping, loadTicketsForPreview, loadZohoMoveDetail, toMappings } from './data'
import { coerceFieldValue, formDataEntry, type CoerceField } from './coerce'
import { fieldKey } from './plan'
import { isFinishedCkStatus } from './suggest'
import { addMissingFieldDefinitions, formDataHas } from './refresh-pure'
import { copyAttachments, loadZohoFieldLabels } from './move'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }
const db = () => createAdminClient() as unknown as AnyClient

export const REFRESH_BATCH_LIMIT = 100

export type RefreshResult = { zohoNo: number; ok: boolean; requestNo?: string; filled: string[]; left: string[]; files?: { copied: number; missing: number; already: number }; technician?: 'had' | 'assigned' | 'none' | 'finished' | 'failed'; reason?: string }

export async function refreshMovedFields(args: { orgId: string; actorId: string; numbers: number[] }): Promise<RefreshResult[]> {
  const { orgId, actorId } = args
  const numbers = [...new Set(args.numbers.filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, REFRESH_BATCH_LIMIT)
  if (numbers.length === 0) return []
  const maps = toMappings(await loadSavedMapping(orgId))
  const out: RefreshResult[] = []
  for (const n of numbers) {
    try { out.push(await refreshOne(orgId, actorId, n, maps)) } catch (e) {
      logger.error({ event: 'zoho_transfer.refresh_failed', message: `Filling in the fields of moved Zoho ticket ${n} failed`, route: 'lib/zoho/transfer/refresh.ts', orgId, errorCode: 'zoho_refresh_failed', context: { zohoNo: n }, error: e })
      out.push({ zohoNo: n, ok: false, filled: [], left: [], reason: 'Something went wrong. Nothing was changed on this ticket.' })
    }
  }
  return out
}

async function refreshOne(orgId: string, actorId: string, n: number, maps: ReturnType<typeof toMappings>): Promise<RefreshResult> {
  const d = db()
  const fail = (reason: string): RefreshResult => ({ zohoNo: n, ok: false, filled: [], left: [], reason })

  const { data: tr } = await d.from('zoho_transfers').select('request_id').eq('org_id', orgId).eq('zoho_ticket_no', n).eq('state', 'moved').maybeSingle()
  if (!tr?.request_id) return fail('This Zoho ticket has not been moved to CK Desk.')
  const { data: req } = await d.from('requests').select('id, request_no, status, assigned_to, service_id, form_data, form_sections_snapshot').eq('id', tr.request_id).eq('org_id', orgId).maybeSingle()
  if (!req) return fail('The CK Desk ticket was not found.')

  const { rows } = await loadTicketsForPreview({ numbers: String(n) }, [])
  const ticket = rows.find((r) => r.displayId === n)
  if (!ticket) return fail('This Zoho ticket was not found in Zoho.')

  const { data: service } = await d.from('services').select('*, template:form_templates (form_sections)').eq('id', req.service_id).eq('org_id', orgId).maybeSingle()
  if (!service) return fail('The CK Desk service of this ticket was not found.')
  const current = resolveServiceFormSections(service)
  const allFields = current.flatMap((s) => s.fields) as FormField[]

  const labels = await loadZohoFieldLabels()
  const template = String(ticket.template ?? '').trim()
  const formData: Record<string, unknown> = { ...((req.form_data as Record<string, unknown> | null) ?? {}) }
  const filled: string[] = []
  const left: string[] = []
  const filledIds: string[] = []
  const lines: string[] = []

  for (const [zohoField, value] of Object.entries(ticket.fields)) {
    const ckId = maps.fields.get(fieldKey(template, zohoField))
    if (!ckId) continue                                  // not mapped: nothing to fill (it stays in the Zoho note)
    const label = labels.get(zohoField) ?? zohoField
    const field = allFields.find((f) => f.id === ckId)
    if (!field) { left.push(`${label}: the mapped CK Desk field is not on the service's form`); continue }
    if (formDataHas(formData, field.id)) continue        // already has a value: never overwritten
    const res = coerceFieldValue(field as unknown as CoerceField, value)
    if (!res.ok) { left.push(`${label}: ${res.reason}`); continue }
    formData[field.id] = formDataEntry(field as unknown as CoerceField, res.value)
    filledIds.push(field.id)
    filled.push(`${label} → ${field.label ?? field.id}`)
    lines.push(`  • ${label} → ${field.label ?? field.id}: ${value}`)
  }
  const files = await addMissingFiles(d, actorId, req.id, n)
  const technician = await assignIfNone(d, req.id, req.status as string, req.assigned_to as string | null)
  if (filledIds.length === 0) return { zohoNo: n, ok: true, requestNo: req.request_no, filled, left, files, technician }

  const snapshot = addMissingFieldDefinitions(req.form_sections_snapshot, current, filledIds)
  const { error } = await d.from('requests').update({ form_data: formData, form_sections_snapshot: snapshot }).eq('id', req.id).eq('org_id', orgId)
  if (error) throw new Error(error.message)
  await d.from('request_comments').insert({
    request_id: req.id, author_id: actorId, is_internal: true, source: 'portal',
    body: ['FILLED IN FROM ZOHO LATER — these Zoho values were added to empty CK Desk fields of this ticket:', ...lines].join('\n'),
  })
  return { zohoNo: n, ok: true, requestNo: req.request_no, filled, left, files, technician }
}

/**
 * A ticket that has no technician and is not finished gets CK Desk's own Business Rules run again, quietly (the same run the move does): useful when something the rules look at was
 * wrong at the time of the move (for example the requester was a placeholder and was matched to the right person afterwards). A technician already on the ticket is never changed;
 * a finished ticket keeps the Zoho technician it was moved with.
 */
async function assignIfNone(d: AnyClient, requestId: string, status: string, assignedTo: string | null): Promise<'had' | 'assigned' | 'none' | 'finished' | 'failed'> {
  if (assignedTo) return 'had'
  if (isFinishedCkStatus(status)) return 'finished'
  try {
    const { runRulesForTrigger } = await import('@/lib/rules/run')
    await runRulesForTrigger('created', requestId, { quiet: true })
  } catch (e) {
    logger.warn({ event: 'zoho_transfer.rules_failed', message: 'Quiet Business Rules failed while filling in a moved ticket', route: 'lib/zoho/transfer/refresh.ts', requestId, error: e })
    return 'failed'
  }
  const { data } = await d.from('requests').select('assigned_to').eq('id', requestId).maybeSingle()
  return data?.assigned_to ? 'assigned' : 'none'
}

/** Attaches the Zoho files that are not on the CK Desk ticket yet (matched by file name, so a file already there is never added twice). */
async function addMissingFiles(d: AnyClient, actorId: string, requestId: string, n: number): Promise<{ copied: number; missing: number; already: number }> {
  const detail = await loadZohoMoveDetail(n)
  const all = detail?.attachments ?? []
  if (all.length === 0) return { copied: 0, missing: 0, already: 0 }
  const { data: have } = await d.from('request_attachments').select('file_name').eq('request_id', requestId)
  const names = new Set(((have ?? []) as { file_name: string }[]).map((x) => x.file_name))
  const todo = all.filter((a) => !names.has(a.fileName))
  if (todo.length === 0) return { copied: 0, missing: 0, already: all.length }
  const notes = await copyAttachments({ actorId }, requestId, new Date().toISOString(), todo, { later: true })
  const copied = Number((notes.find((x) => x.includes('attachment(s) copied')) ?? '').split(' ')[0]) || 0
  return { copied, missing: todo.length - copied, already: all.length - todo.length }
}

