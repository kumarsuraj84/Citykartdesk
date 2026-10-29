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

/** One check of the three sheets for an organisation: reads the saved Google connection, syncs, and tells the admins when something stops working. */
export async function runMastersSyncForOrg(orgId: string, opts: { force?: boolean } = {}): Promise<SyncReport | { error: string }> {
  const db = createAdminClient() as unknown as Db
  const resolved = await sheetsSourceForOrg(db, orgId)
  if ('error' in resolved) return { error: resolved.error }
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
  try { await runProgramsSync({ db, orgId, source, tellAdmins }) } catch (e) { console.error('[programs] sheet copy failed', e) }
  // AC PMS: the tickets of the PMS dates that are due now (from 09:00 on the day; nothing happens when the PMS sheet is not set up)
  await createDuePmsTickets(db, orgId)
  return report
}
