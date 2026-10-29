import 'server-only'
import { createRequestCore } from '@/lib/requests/create-request-core'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import { loadActiveAcUnits } from '@/lib/masters/resolve'
import { pmsDateLabel, pmsDueRange } from '@/lib/pms/window'
import type { FormField } from '@/types'

// AC PMS tickets made from the AC PMS Google Sheet (Store Code + AC PMS Date). Called after every copy of the sheets (09:00 job and the 11:00, 15:00, 19:00 copies):
//  - for each store whose PMS date is due (see lib/pms/window.ts) ONE ticket is made, in the AC PMS service / category / sub-category, raised from the store's own login;
//  - pms_ticket_log keeps one row per store and date, so a date never makes two tickets, whatever runs twice or restarts;
//  - a date that cannot be made (no category set, store unknown, no login, ticket refused) is written to the log and shown in the Sheet Masters problem list, and tried
//    again at the next run of the same day (a date that has passed is never made).
// Never throws: the sheet copy must not fail because of this.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type PmsRunResult = {
  created: number
  alreadyDone: number
  skipped: number
  failed: number
  /** the whole step could not start (not configured / no PMS category / no service) */
  setupProblem?: string
}

export type PmsSetup = { categoryId: string; subCategoryId: string; serviceId: string }

const MAX_PER_RUN = 150
const SKIP_CODE = 'pms_no_ticket'

/**
 * The category marked "AC PMS" in Admin, its sub-category and the active service that sub-category is tagged to. `programId` null = the old, built-in AC PMS (a category of NO program);
 * a program id = that Vendor Program's own PMS category (a category of that program that is ticked "AC PMS category").
 */
export async function findPmsSetup(db: Db, orgId: string, programId: string | null = null): Promise<{ setup: PmsSetup } | { problem: string }> {
  let catQuery = db.from('service_categories').select('id, name').eq('org_id', orgId).eq('is_pms', true).eq('is_active', true)
  catQuery = programId ? catQuery.eq('program_id', programId) : catQuery.is('program_id', null)
  const { data: cats } = await catQuery.order('name')
  const catIds = ((cats ?? []) as { id: string }[]).map((c) => c.id)
  if (catIds.length === 0) {
    return { problem: programId
      ? 'This program has no PMS category. Make a category for the PMS tickets, tick "AC PMS category" on it (Admin > Categories), and add it to this program.'
      : 'No category is marked as the AC PMS category. In Admin > Categories, edit the AC PMS category and tick "AC PMS category".' }
  }
  const { data: subs } = await db.from('service_sub_categories').select('id, category_id, name').in('category_id', catIds).eq('is_active', true).order('name')
  const subList = (subs ?? []) as { id: string; category_id: string }[]
  if (subList.length === 0) return { problem: 'The AC PMS category has no active sub-category.' }
  const { data: tags } = await db.from('service_sub_category_tags').select('service_id, sub_category_id').in('sub_category_id', subList.map((s) => s.id))
  const tagList = (tags ?? []) as { service_id: string; sub_category_id: string }[]
  if (tagList.length === 0) return { problem: 'The AC PMS sub-category is not added to any service. Add it to the AC PMS service in Admin > Services.' }
  const { data: services } = await db.from('services').select('id').eq('org_id', orgId).eq('is_active', true).in('id', [...new Set(tagList.map((t) => t.service_id))])
  const active = new Set(((services ?? []) as { id: string }[]).map((s) => s.id))
  for (const sub of subList) {
    const tag = tagList.find((t) => t.sub_category_id === sub.id && active.has(t.service_id))
    if (tag) return { setup: { categoryId: sub.category_id, subCategoryId: sub.id, serviceId: tag.service_id } }
  }
  return { problem: 'The AC PMS sub-category is added only to switched-off services. Switch the AC PMS service on.' }
}

/** The boxes of the service's form that the ticket fills itself: the subject and the description (found by their names; any other box is left for people). */
export function textFields(sections: ReturnType<typeof resolveServiceFormSections>): { subject?: FormField; description?: FormField } {
  const all = sections.flatMap((s) => s.fields ?? [])
  const subject = all.find((f) => /^(subject|title)$/i.test(f.label.trim()) && (f.type === 'text' || f.type === 'textarea')) ?? all.find((f) => f.type === 'text')
  const description = all.find((f) => /^description$/i.test(f.label.trim()) && f.type === 'textarea') ?? all.find((f) => f.type === 'textarea')
  return { subject, description }
}

async function claim(db: Db, orgId: string, storeCode: string, pmsDate: string): Promise<boolean> {
  const fresh = await db.from('pms_ticket_log')
    .upsert({ org_id: orgId, store_code: storeCode, pms_date: pmsDate, status: 'creating' }, { onConflict: 'org_id,store_code,pms_date', ignoreDuplicates: true }).select('status')
  if (fresh.data?.length) return true
  // an earlier try that was skipped or failed, or one that got stuck while "creating" (the server stopped)
  const stuck = new Date(Date.now() - 10 * 60_000).toISOString()
  const again = await db.from('pms_ticket_log')
    .update({ status: 'creating', note: null, updated_at: new Date().toISOString() })
    .eq('org_id', orgId).eq('store_code', storeCode).eq('pms_date', pmsDate)
    .or(`status.in.(skipped,failed),and(status.eq.creating,updated_at.lt.${stuck})`).select('status')
  return !!again.data?.length
}

async function settle(db: Db, orgId: string, storeCode: string, pmsDate: string, status: 'created' | 'skipped' | 'failed', requestId: string | null, note: string | null) {
  await db.from('pms_ticket_log').update({ status, request_id: requestId, note, updated_at: new Date().toISOString() }).eq('org_id', orgId).eq('store_code', storeCode).eq('pms_date', pmsDate)
}

export async function createDuePmsTickets(db: Db, orgId: string, now: Date = new Date()): Promise<PmsRunResult> {
  const out: PmsRunResult = { created: 0, alreadyDone: 0, skipped: 0, failed: 0 }
  try {
    const { data: src } = await db.from('master_sources').select('spreadsheet_id').eq('org_id', orgId).eq('kind', 'pms').maybeSingle()
    if (!src?.spreadsheet_id) return out   // the PMS sheet is not set up: nothing to do, nothing to report

    const range = pmsDueRange(now)
    const found = await findPmsSetup(db, orgId)
    if ('problem' in found) {
      out.setupProblem = found.problem
      await refreshIssues(db, orgId, range.from, found.problem)
      return out
    }
    const { setup } = found

    const { data: dues } = await db.from('master_pms_dates').select('store_code, pms_date').eq('org_id', orgId).gte('pms_date', range.from).lte('pms_date', range.to).order('pms_date').order('store_code')
    const due = (dues ?? []) as { store_code: string; pms_date: string }[]
    if (due.length > 0) {
      const { data: service } = await db.from('services').select('form_sections, form_fields, template:form_templates(form_sections)').eq('id', setup.serviceId).maybeSingle()
      const tpl = Array.isArray(service?.template) ? service?.template[0] : service?.template
      const fields = textFields(resolveServiceFormSections({ form_sections: service?.form_sections, form_fields: service?.form_fields, template: tpl ?? null }))

      let made = 0
      for (const d of due) {
        const { data: done } = await db.from('pms_ticket_log').select('status').eq('org_id', orgId).eq('store_code', d.store_code).eq('pms_date', d.pms_date).maybeSingle()
        if (done?.status === 'created') { out.alreadyDone++; continue }
        if (made >= MAX_PER_RUN) break
        if (!(await claim(db, orgId, d.store_code, d.pms_date))) { out.alreadyDone++; continue }
        made++
        try {
          const { data: store } = await db.from('stores').select('id, name, code').eq('org_id', orgId).eq('code', d.store_code).maybeSingle()
          if (!store) { await settle(db, orgId, d.store_code, d.pms_date, 'skipped', null, `Store ${d.store_code} is not in the CK Desk store master.`); out.skipped++; continue }
          const { data: logins } = await db.from('profiles').select('id').eq('org_id', orgId).eq('store_id', store.id).eq('is_active', true).eq('role', 'user').is('vendor_company_id', null).order('created_at', { ascending: true }).limit(1)
          const requesterId = (logins ?? [])[0]?.id as string | undefined
          if (!requesterId) { await settle(db, orgId, d.store_code, d.pms_date, 'skipped', null, `Store ${d.store_code} has no active login in CK Desk, so the PMS ticket could not be raised.`); out.skipped++; continue }

          const label = pmsDateLabel(d.pms_date)
          const title = `AC PMS - ${store.name} - ${label}`
          const text = `Scheduled AC PMS (preventive maintenance) of the ACs of ${store.name} (${store.code}), planned for ${label}.`
          const formData: Record<string, unknown> = {}
          if (fields.subject) formData[fields.subject.id] = title
          if (fields.description) formData[fields.description.id] = text
          // the store's active ACs go with the ticket (before the Business Rules run), so a rule that routes AC tickets by the AC's vendor / region routes the PMS ticket the same way
          const acUnits = await loadActiveAcUnits(db, orgId, store.code)
          const res = await createRequestCore({
            client: db, orgId, requesterId, actingUserId: requesterId,
            serviceId: setup.serviceId, subCategoryId: setup.subCategoryId, formData,
            description: fields.description ? null : text,
            source: 'api', sourceMetadata: { pms_source: 'ac_pms_sheet', pms_date: d.pms_date, store_code: d.store_code },
            useAdminForWrites: true, titleOverride: title, acUnitsForRouting: acUnits, systemGenerated: true,
          })
          if (res.error || !res.requestId) { await settle(db, orgId, d.store_code, d.pms_date, 'failed', null, res.error ?? 'The ticket could not be created.'); out.failed++; continue }
          await settle(db, orgId, d.store_code, d.pms_date, 'created', res.requestId, null)
          if (acUnits.length === 0) {
            // nothing to route by: the ticket exists but no rule can hand it to a vendor, so the people who work tickets are told
            await db.from('request_comments').insert({ request_id: res.requestId, author_id: requesterId, is_internal: true, body: `The AC sheet lists no active AC for store ${store.code}, so this PMS ticket could not be given to a vendor technician automatically. Please assign it yourself.` })
          }
          out.created++
        } catch (e) {
          console.error('[pms] ticket failed', d.store_code, d.pms_date, e)
          await settle(db, orgId, d.store_code, d.pms_date, 'failed', null, 'The ticket could not be created.').catch(() => {})
          out.failed++
        }
      }
    }
    await refreshIssues(db, orgId, range.from, null)
  } catch (e) {
    console.error('[pms] run failed', e)
  }
  return out
}

/** The problem list of the Sheet Masters page for the PMS sheet: what could not be made (not set up, no login, refused). Rewritten at every run. */
async function refreshIssues(db: Db, orgId: string, fromDate: string, setupProblem: string | null) {
  try {
    await db.from('master_issues').delete().eq('org_id', orgId).eq('kind', 'pms').eq('code', SKIP_CODE)
    const rows: { org_id: string; kind: 'pms'; severity: 'error' | 'warning'; code: string; store_code: string | null; sheet_row: number | null; message: string }[] = []
    if (setupProblem) rows.push({ org_id: orgId, kind: 'pms', severity: 'error', code: SKIP_CODE, store_code: null, sheet_row: null, message: `PMS tickets cannot be made: ${setupProblem}` })
    const { data: bad } = await db.from('pms_ticket_log').select('store_code, pms_date, status, note').eq('org_id', orgId).in('status', ['skipped', 'failed']).gte('pms_date', fromDate).order('pms_date').limit(200)
    for (const b of (bad ?? []) as { store_code: string; pms_date: string; status: string; note: string | null }[]) {
      rows.push({ org_id: orgId, kind: 'pms', severity: 'error', code: SKIP_CODE, store_code: b.store_code, sheet_row: null, message: `PMS of ${b.store_code} on ${pmsDateLabel(b.pms_date)}: no ticket made. ${b.note ?? ''}`.trim() })
    }
    if (rows.length > 0) await db.from('master_issues').insert(rows)
  } catch (e) {
    console.error('[pms] could not save the problem list', e)
  }
}
