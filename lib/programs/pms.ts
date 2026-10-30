import { createRequestCore } from '@/lib/requests/create-request-core'
import { resolveServiceFormSections } from '@/lib/forms/sections'
import { findExistingPmsTicket, findPmsSetup, MAX_PER_RUN, orderDue, pastDatesWithoutTicket, PMS_PROBLEM_DAYS, textFields } from '@/lib/pms/tickets'
import { addDays, pmsDateLabel, pmsDueRange } from '@/lib/pms/window'
import { PMS_TICKET_PROBLEM_CODE, replacePmsIssues } from './pms-sync'
import type { ProgramIssue, ProgramRecord } from './types'

// PMS (preventive maintenance) tickets of a Vendor Program. OPTIONAL: a program with no PMS sheet saved does nothing here, and nothing about it shows anywhere.
// When a program has one, it works exactly like today's AC PMS, one program at a time:
//  1. the PMS sheet (two columns: Store Code and PMS Date, one row per store and date) is copied into program_pms_dates (read only: nothing is ever written to a sheet);
//  2. from 09:00 India time on the PMS date ONE ticket is made for the store, in the program's PMS category (a category of the program that is ticked "AC PMS category"),
//     raised from the store's own login. Because the category belongs to the program, the ticket is mailed to the program's vendor with ALL the store's machines, and the
//     vendor portal / Business Rules treat it like any ticket of the program;
//  3. program_pms_log keeps one row per program, store and date, so a date never makes two tickets; a date that could not be made says why (shown on the program screen) and is
//     tried again at the next run of the same day. A date that has passed is never made automatically (a product rule), but its problem stays in the program's problem list for
//     7 days. At most MAX_PER_RUN tickets are made per run: the stores not reached are made in the next run of the same day. Before a ticket is made an existing ticket for the
//     store, date and program is looked for (a run that died after the ticket but before the log row), so nothing is made twice.
// A program that is switched off makes no tickets. Never throws: the sheet copy must not fail because of this.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any }

export type ProgramPmsRunResult = { created: number; alreadyDone: number; skipped: number; failed: number; /** due dates not reached in this run (the limit of one run); made in the next run of the same day */ waiting: number; setupProblem?: string }

// ── 2. making the tickets ──

async function claim(db: Db, orgId: string, programId: string, storeCode: string, pmsDate: string): Promise<boolean> {
  const fresh = await db.from('program_pms_log')
    .upsert({ org_id: orgId, program_id: programId, store_code: storeCode, pms_date: pmsDate, status: 'creating' }, { onConflict: 'program_id,store_code,pms_date', ignoreDuplicates: true }).select('status')
  if (fresh.data?.length) return true
  // an earlier try that was skipped or failed, or one that got stuck while "creating" (the server stopped)
  const stuck = new Date(Date.now() - 10 * 60_000).toISOString()
  const again = await db.from('program_pms_log')
    .update({ status: 'creating', note: null, updated_at: new Date().toISOString() })
    .eq('program_id', programId).eq('store_code', storeCode).eq('pms_date', pmsDate)
    .or(`status.in.(skipped,failed),and(status.eq.creating,updated_at.lt.${stuck})`).select('status')
  return !!again.data?.length
}

async function settle(db: Db, programId: string, storeCode: string, pmsDate: string, status: 'created' | 'skipped' | 'failed', requestId: string | null, note: string | null): Promise<boolean> {
  const res = await db.from('program_pms_log').update({ status, request_id: requestId, note, updated_at: new Date().toISOString() }).eq('program_id', programId).eq('store_code', storeCode).eq('pms_date', pmsDate)
  if (res?.error) { console.error('[program pms] could not write the log row', programId, storeCode, pmsDate, res.error.message); return false }
  return true
}

/** The PMS tickets that are due now for ONE program. Does nothing for a program without a PMS sheet, or one that is switched off. */
export async function createDueProgramPmsTickets(db: Db, orgId: string, program: ProgramRecord, now: Date = new Date()): Promise<ProgramPmsRunResult> {
  const out: ProgramPmsRunResult = { created: 0, alreadyDone: 0, skipped: 0, failed: 0, waiting: 0 }
  try {
    if (!program.pms_spreadsheet_id || !program.is_active) return out
    const range = pmsDueRange(now)
    const found = await findPmsSetup(db, orgId, program.id)
    if ('problem' in found) {
      out.setupProblem = found.problem
      await refreshTicketIssues(db, orgId, program, range.today, found.problem)
      return out
    }
    const { setup } = found

    const { data: dues } = await db.from('program_pms_dates').select('store_code, pms_date').eq('program_id', program.id).gte('pms_date', range.from).lte('pms_date', range.to).order('pms_date').order('store_code')
    const due = (dues ?? []) as { store_code: string; pms_date: string }[]
    if (due.length > 0) {
      const { data: service } = await db.from('services').select('form_sections, form_fields, template:form_templates(form_sections)').eq('id', setup.serviceId).maybeSingle()
      const tpl = Array.isArray(service?.template) ? service?.template[0] : service?.template
      const fields = textFields(resolveServiceFormSections({ form_sections: service?.form_sections, form_fields: service?.form_fields, template: tpl ?? null }))
      const { data: logs } = await db.from('program_pms_log').select('store_code, pms_date, status').eq('program_id', program.id).gte('pms_date', range.from).lte('pms_date', range.to)
      const statusOf = new Map(((logs ?? []) as { store_code: string; pms_date: string; status: string }[]).map((l) => [`${l.store_code}|${l.pms_date}`, l.status]))
      const { todo, created } = orderDue(due, (d) => statusOf.get(`${d.store_code}|${d.pms_date}`))
      out.alreadyDone += created
      let made = 0
      for (let at = 0; at < todo.length; at++) {
        const d = todo[at]
        // the limit of one run: the rest are NOT dropped, they are made in the next run of the same day
        if (made >= MAX_PER_RUN) { out.waiting = todo.length - at; break }
        if (!(await claim(db, orgId, program.id, d.store_code, d.pms_date))) { out.alreadyDone++; continue }
        made++
        try {
          // a ticket for this program, store and date may already exist (an earlier run died before it wrote the log row): settle the row with it instead of making a second ticket and a second mail
          const existing = await findExistingPmsTicket(db, orgId, { source: 'program_pms_sheet', storeCode: d.store_code, pmsDate: d.pms_date, programId: program.id })
          if (existing) { await settle(db, program.id, d.store_code, d.pms_date, 'created', existing, null); out.alreadyDone++; continue }
          const { data: store } = await db.from('stores').select('id, name, code').eq('org_id', orgId).eq('code', d.store_code).maybeSingle()
          if (!store) { await settle(db, program.id, d.store_code, d.pms_date, 'skipped', null, `Store ${d.store_code} is not in the CK Desk store master.`); out.skipped++; continue }
          const { data: logins } = await db.from('profiles').select('id').eq('org_id', orgId).eq('store_id', store.id).eq('is_active', true).eq('role', 'user').is('vendor_company_id', null).order('created_at', { ascending: true }).limit(1)
          const requesterId = (logins ?? [])[0]?.id as string | undefined
          if (!requesterId) { await settle(db, program.id, d.store_code, d.pms_date, 'skipped', null, `Store ${d.store_code} has no active login in CK Desk, so the PMS ticket could not be raised.`); out.skipped++; continue }

          const label = pmsDateLabel(d.pms_date)
          const title = `${program.name} PMS - ${store.name} - ${label}`
          const text = `Scheduled ${program.name} PMS (preventive maintenance) of the machines of ${store.name} (${store.code}), planned for ${label}.`
          const formData: Record<string, unknown> = {}
          if (fields.subject) formData[fields.subject.id] = title
          if (fields.description) formData[fields.description.id] = text
          const res = await createRequestCore({
            client: db as never, orgId, requesterId, actingUserId: requesterId,
            serviceId: setup.serviceId, subCategoryId: setup.subCategoryId, formData,
            description: fields.description ? null : text,
            source: 'api', sourceMetadata: { pms_source: 'program_pms_sheet', program_id: program.id, pms_date: d.pms_date, store_code: d.store_code },
            useAdminForWrites: true, titleOverride: title, systemGenerated: true,
          })
          if (res.error || !res.requestId) { await settle(db, program.id, d.store_code, d.pms_date, 'failed', null, res.error ?? 'The ticket could not be created.'); out.failed++; continue }
          await settle(db, program.id, d.store_code, d.pms_date, 'created', res.requestId, null)
          out.created++
        } catch (e) {
          console.error('[program pms] ticket failed', program.id, d.store_code, d.pms_date, e)
          await settle(db, program.id, d.store_code, d.pms_date, 'failed', null, 'The ticket could not be created.').catch(() => {})
          out.failed++
        }
      }
    }
    await refreshTicketIssues(db, orgId, program, range.today, null, out.waiting)
  } catch (e) {
    console.error('[program pms] run failed', e)
  }
  return out
}

/** What could not be made (not set up, no login, refused), shown on the program screen; rewritten at every run. */
async function refreshTicketIssues(db: Db, orgId: string, program: ProgramRecord, today: string, setupProblem: string | null, waiting = 0) {
  try {
    const fromDate = addDays(today, -PMS_PROBLEM_DAYS)   // a date that could not be made stays listed for 7 days after its day
    const stuckBefore = new Date(Date.now() - 30 * 60_000).toISOString()
    const issues: ProgramIssue[] = []
    if (waiting > 0) issues.push({ severity: 'warning', code: PMS_TICKET_PROBLEM_CODE, storeCode: null, sheetRow: null, message: `${waiting} ${program.name} PMS ticket(s) due today were not reached in this run (the limit of one run). They are made in the next run today.` })
    if (setupProblem) issues.push({ severity: 'error', code: PMS_TICKET_PROBLEM_CODE, storeCode: null, sheetRow: null, message: `${program.name} PMS tickets cannot be made: ${setupProblem}` })
    const { data: bad } = await db.from('program_pms_log').select('store_code, pms_date, status, note, updated_at').eq('program_id', program.id).in('status', ['skipped', 'failed', 'creating']).gte('pms_date', fromDate).order('pms_date').limit(200)
    for (const b of (bad ?? []) as { store_code: string; pms_date: string; status: string; note: string | null; updated_at: string }[]) {
      if (b.status === 'creating' && b.updated_at > stuckBefore) continue   // being made right now
      const why = b.status === 'creating' ? 'The run that was making it stopped half way.' : (b.note ?? '')
      const past = b.pms_date < today ? ' This date has passed, so it is not made automatically: make the ticket by hand if the visit is still needed.' : ''
      issues.push({ severity: 'error', code: PMS_TICKET_PROBLEM_CODE, storeCode: b.store_code, sheetRow: null, message: `${program.name} PMS of ${b.store_code} on ${pmsDateLabel(b.pms_date)}: no ticket made. ${why}${past}`.trim() })
    }
    // a past date the run never even tried (the job did not run that day): no log row exists, so it would otherwise vanish without a trace
    const gaps = await pastDatesWithoutTicket(db, 'program_pms_dates', { program_id: program.id }, 'program_pms_log', { program_id: program.id }, fromDate, today)
    for (const g of gaps) issues.push({ severity: 'error', code: PMS_TICKET_PROBLEM_CODE, storeCode: g.store_code, sheetRow: null, message: `${program.name} PMS of ${g.store_code} on ${pmsDateLabel(g.pms_date)}: no ticket was made and nothing was recorded (the job did not run that day?). This date has passed, so it is not made automatically: make the ticket by hand if the visit is still needed.` })
    await replacePmsIssues(db, orgId, program.id, issues, (code) => code === PMS_TICKET_PROBLEM_CODE)
  } catch (e) {
    console.error('[program pms] could not save the problem list', e)
  }
}

/** Every switched-on program of the organisation that has a PMS sheet. */
export async function createDueProgramPmsTicketsForOrg(db: Db, orgId: string, now: Date = new Date()): Promise<Record<string, ProgramPmsRunResult>> {
  const out: Record<string, ProgramPmsRunResult> = {}
  const { data } = await db.from('vendor_programs').select('*').eq('org_id', orgId).eq('is_active', true).not('pms_spreadsheet_id', 'is', null)
  for (const program of (data ?? []) as ProgramRecord[]) out[program.id] = await createDueProgramPmsTickets(db, orgId, program, now)
  return out
}
