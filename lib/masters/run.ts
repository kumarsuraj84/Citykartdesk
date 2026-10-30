import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadCvmCandidates } from '@/lib/cvm/load'
import { sendEmail } from '@/lib/email/send'
import { escapeHtml } from '@/lib/email/escape'
import { sheetsSourceForOrg } from './source'
import { syncMasters, type SyncReport } from './sync'
import { resetCcBookCache } from '@/lib/requests/cc-recipients'
import type { MasterKind } from './types'
import { createDuePmsTickets } from '@/lib/pms/tickets'
import { istNow } from '@/lib/pms/window'
import { createDueProgramPmsTicketsForOrg } from '@/lib/programs/pms'
import { runProgramsSync } from '@/lib/programs/run'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }> }

const KIND_LABEL: Record<MasterKind, string> = { ac: 'AC DETAILS', genset: 'GENSET Detail', cvm: 'CVM Detail', pms: 'AC PMS' }

async function adminEmails(db: Db, orgId: string): Promise<string[]> {
  const admin = createAdminClient()
  const { data } = await db.from('profiles').select('id').eq('org_id', orgId).eq('is_active', true).eq('role', 'admin')
  const out: string[] = []
  for (const p of (data ?? []) as { id: string }[]) {
    const { data: u } = await admin.auth.admin.getUserById(p.id)
    if (u?.user?.email) out.push(u.user.email)
  }
  return out
}

async function tellAdmins(db: Db, orgId: string, subject: string, message: string) {
  try {
    const to = await adminEmails(db, orgId)
    if (to.length === 0) return
    await sendEmail({ to, subject, html: `<p>${escapeHtml(message)}</p><p>Open Admin &rarr; Master data to see the details.</p>`, text: `${message}\n\nOpen Admin > Master data to see the details.` })
  } catch (e) {
    console.error('[masters] could not e-mail the admins', e)
  }
}

/**
 * Makes the PMS tickets that are due now (the old AC PMS and every switched-on program's own PMS). They are made from CK Desk's OWN copy of the PMS dates, never from Google, so this
 * runs whether or not the Google connection works: a missing or broken connection must not silently stop all PMS tickets (a missed date is never made later). Never throws.
 * When due dates could not be made because of a failure (no category set up, a ticket refused, ...), the administrators are told ONCE PER DAY.
 */
export async function makeDuePmsTicketsForOrg(db: Db, orgId: string, now: Date = new Date()): Promise<{ problems: number }> {
  const notes: string[] = []
  let problems = 0
  try {
    const r = await createDuePmsTickets(db, orgId, now)
    problems += r.failed + r.skipped
    if (r.setupProblem) { problems++; notes.push(`AC PMS: ${r.setupProblem}`) }
    if (r.failed + r.skipped > 0) notes.push(`AC PMS: ${r.failed + r.skipped} date(s) due today could not be made`)
  } catch (e) { console.error('[pms] ticket step failed', e) }
  // the same for every Vendor Program that has its own (optional) PMS sheet and is switched on
  try {
    const all = await createDueProgramPmsTicketsForOrg(db, orgId, now)
    for (const r of Object.values(all)) {
      problems += r.failed + r.skipped
      if (r.setupProblem) { problems++; notes.push(`Program PMS: ${r.setupProblem}`) }
      if (r.failed + r.skipped > 0) notes.push(`Program PMS: ${r.failed + r.skipped} date(s) due today could not be made`)
    }
  } catch (e) { console.error('[programs] PMS tickets failed', e) }
  if (notes.length > 0) {
    try {
      // one mail per organisation per India day: the claim is one row in app_settings (the key is unique), the same trick the sheet copy lock uses
      const key = `pms_alert:${orgId}:${istNow(now).date}`
      const claimed = await db.from('app_settings').insert({ key, value: now.toISOString() })
      if (!claimed.error) {
        await tellAdmins(db, orgId, 'CK Desk could not make some PMS tickets', `${notes.slice(0, 6).join('. ')}. A PMS date that has passed is not made automatically, so please look at the problem list (Admin > Master data, and the program's screen) and make the ticket by hand if the visit is still needed.`)
      }
    } catch (e) { console.error('[pms] could not tell the admins', e) }
  }
  return { problems }
}

/** One check of the sheets for an organisation: reads the saved Google connection, syncs, and tells the admins when something stops working. The PMS tickets are made at the end WHATEVER happens to the sheet copy. */
export async function runMastersSyncForOrg(orgId: string, opts: { force?: boolean } = {}): Promise<SyncReport | { error: string }> {
  const db = createAdminClient() as unknown as Db
  try {
    const resolved = await sheetsSourceForOrg(db, orgId)
    if ('error' in resolved) return { error: resolved.error }
    return await syncSheets(db, orgId, resolved, opts)
  } finally {
    // PMS tickets come from the database copy, so a missing / broken Google connection or a failed sheet copy must not stop them (PMS_CATCH_UP_DAYS = 0: a missed date is never made)
    await makeDuePmsTicketsForOrg(db, orgId).catch((e) => console.error('[pms] ticket step failed', e))
  }
}

async function syncSheets(db: Db, orgId: string, resolved: Exclude<Awaited<ReturnType<typeof sheetsSourceForOrg>>, { error: string }>, opts: { force?: boolean }): Promise<SyncReport> {
  const { source, conn } = resolved

  const before = new Map<string, string | null>()
  const { data: srcs } = await db.from('master_sources').select('kind, last_status').eq('org_id', orgId)
  for (const s of (srcs ?? []) as { kind: string; last_status: string | null }[]) before.set(s.kind, s.last_status)

  const candidates = await loadCvmCandidates(orgId)
  const report = await syncMasters({
    db, orgId, source, force: opts.force,
    cvmEmailKnown: async (email) => (candidates.byEmail.has(email.toLowerCase()) ? 'ok' : 'unknown'),
  })

  resetCcBookCache()   // the OEM contacts offered when copying people follow the sheets
  for (const kind of ['ac', 'genset', 'cvm', 'pms'] as MasterKind[]) {
    const r = report[kind]
    if (r.status === 'error' && before.get(kind) !== 'error') {
      await tellAdmins(db, orgId, `CK Desk could not read the ${KIND_LABEL[kind]} sheet`, `The ${KIND_LABEL[kind]} Google Sheet could not be read: ${r.message ?? 'unknown problem'}. CK Desk keeps working with the last good copy.`)
    }
  }
  // a refused connection is reported once, and the connection is marked so the page can ask for a new one
  const authFailure = (['ac', 'genset', 'cvm', 'pms'] as MasterKind[]).map((k) => report[k]).find((r) => r.status === 'error' && /connect Google Sheets again|no longer accepts/i.test(r.message ?? ''))
  if (authFailure && conn?.status === 'connected') {
    await db.from('master_google_connection').update({ status: 'broken', last_error: authFailure.message ?? null }).eq('org_id', orgId)
    await tellAdmins(db, orgId, 'CK Desk lost its Google Sheets connection', authFailure.message ?? 'Connect Google Sheets again.')
  }
  // the Vendor Programs' sheets (Admin -> Vendor Programs) are copied in the same pass, with the same safety rules; a failure here never stops the rest
  try { await runProgramsSync({ db, orgId, source, tellAdmins, force: opts.force }) } catch (e) { console.error('[programs] sheet copy failed', e) }
  return report
}
