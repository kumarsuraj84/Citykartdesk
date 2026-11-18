// "Send the approval from CK Desk" for a moved ticket that was waiting for approval in Zoho, against the LOCAL database (it refuses anything else): the CK Desk approval is created for the
// person Zoho named, ONLY that person is told, the ticket stays "pending approval", the requester is not told, and a second try changes nothing. Needs the audit stack's demo Zoho tickets
// and demo mapping (otherwise NOT RUN, never passed).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'fs'
import { execFileSync } from 'child_process'
import { dbContainer } from '../setup/db-container'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v

const psql = (db: string, q: string) => execFileSync('docker', ['exec', dbContainer(), 'psql', '-U', 'postgres', '-d', db, '-tA', '-c', q], { encoding: 'utf8' }).trim()
const sql = (q: string) => psql('postgres', q)

let ready = false
let orgId = ''
let actorId = ''
let zohoNo = 0
let reqId = ''
let requesterId = ''
let approverId = ''
let approverEmail = ''

function cleanup() {
  if (zohoNo) {
    sql(`delete from zoho_transfers where zoho_ticket_no = ${zohoNo}`)
    sql(`delete from requests where request_no = 'ZOHO-${zohoNo}'`)
  }
  sql(`delete from approval_workflows where name like 'Ad-hoc approval ZOHO-%'`)
  sql(`delete from auth.users u where u.raw_user_meta_data->>'created_by' = 'zoho_transfer' and not exists (select 1 from requests r where r.requester_id = u.id or r.assigned_to = u.id) and not exists (select 1 from request_comments c where c.author_id = u.id) and not exists (select 1 from request_activity a where a.actor_id = u.id)`)
}

beforeAll(async () => {
  try {
    expect(process.env.SUPABASE_URL).toMatch(/127\.0\.0\.1|localhost/)
    if (Number(sql('select count(*) from zoho_map_templates')) === 0) return
    orgId = sql('select id from organizations limit 1')
    actorId = sql(`select id from profiles where role = 'admin' limit 1`)
    // an approver that is a normal head-office person (no store link) with a sign-in e-mail
    const row = sql(`select p.id||'|'||u.email from profiles p join auth.users u on u.id = p.id where p.role in ('manager','agent') and p.is_active and p.store_id is null and p.id <> '${actorId}' order by u.email limit 1`)
    ;[approverId, approverEmail] = row.split('|')
    const candidates = psql('zohoaudit', `select display_id from zoho_ticket where display_id between 700020 and 700150 and template = 'Admin Issue log System' and emp_code is not null order by display_id limit 8`).split('\n').filter(Boolean).map(Number)
    const { moveZohoTickets } = await import('@/lib/zoho/transfer/move')
    for (const n of candidates) {
      const [r] = await moveZohoTickets({ orgId, actorId, numbers: [n] })
      if (r.ok) { zohoNo = n; reqId = r.requestId!; break }
    }
    if (!zohoNo || !approverId) return
    requesterId = sql(`select requester_id from requests where id = '${reqId}'`)
    // as it is after a move of a ticket that was waiting for approval: status pending approval, no approval row, and Zoho's own line saying who it was sent to
    sql(`update requests set status = 'pending_approval', assigned_to = null where id = '${reqId}'`)
    sql(`insert into request_comments (request_id, author_id, is_internal, source, body) values ('${reqId}', '${actorId}', true, 'portal', '[Zoho approval] req_approval — Approval mail sent to ${approverEmail} In Stage I By: Someone Else')`)
    ready = true
  } catch (e) { console.warn('[zoho-transfer-approvals] setup failed:', e instanceof Error ? e.message.slice(0, 300) : e); ready = false }
}, 120_000)
afterAll(() => { if (ready) cleanup() })

const skip = (name: string, fn: () => Promise<void>) => it(name, async () => { if (!ready) return; await fn() }, 60_000)
const wait = async (ok: () => boolean) => { for (let i = 0; i < 25 && !ok(); i++) await new Promise((r) => setTimeout(r, 200)) }
const notesFor = (uid: string) => Number(sql(`select count(*) from notifications where user_id = '${uid}' and request_id = '${reqId}'`))

describe('sending the approval of a moved ticket from CK Desk (local database)', () => {
  it('has a movable demo ticket and an approver (otherwise the rest are NOT RUN)', () => { if (!ready) console.warn('[zoho-transfer-approvals] not ready: tests below did not run') })

  skip('shows the person Zoho named as the one it would go to', async () => {
    const { previewMovedApprovals } = await import('@/lib/zoho/transfer/approvals')
    const [t] = await previewMovedApprovals(orgId, [zohoNo])
    expect(t.ready, t.problems.join('; ')).toBe(true)
    expect(t.approvers).toHaveLength(1)
    expect(t.approvers[0].id).toBe(approverId)
  })

  skip('creates the approval, tells ONLY the approver, and keeps the ticket as it is', async () => {
    const { sendMovedApprovals } = await import('@/lib/zoho/transfer/approvals')
    const reqNotes = notesFor(requesterId)
    const apprNotes = notesFor(approverId)
    const activityBefore = Number(sql(`select count(*) from request_activity where request_id = '${reqId}' and action = 'status_changed'`))
    const [r] = await sendMovedApprovals({ orgId, actorId, actorName: 'Test Admin', numbers: [zohoNo] })
    expect(r.ok, r.reason).toBe(true)
    // the approval exists for that person, and they can act on it
    expect(sql(`select status||'|'||current_step from approvals where request_id = '${reqId}'`)).toBe('pending|0')
    expect(sql(`select count(*) from approval_workflow_steps s join approvals a on a.workflow_id = s.workflow_id where a.request_id = '${reqId}' and s.approver_user_id = '${approverId}'`)).toBe('1')
    // the ticket is exactly as before, and remembers where it returns to after the approval
    expect(sql(`select status||'|'||coalesce(pre_approval_status::text,'')||'|'||coalesce(assigned_to::text,'') from requests where id = '${reqId}'`)).toBe('pending_approval|in_progress|')
    expect(Number(sql(`select count(*) from request_activity where request_id = '${reqId}' and action = 'status_changed'`))).toBe(activityBefore)
    // only the approver is told (the notice follows a moment after the approval)
    await wait(() => notesFor(approverId) === apprNotes + 1)
    expect(notesFor(approverId)).toBe(apprNotes + 1)
    expect(notesFor(requesterId)).toBe(requesterId === approverId ? apprNotes + 1 : reqNotes)
    // the history says where this came from
    expect(sql(`select metadata->>'via' from request_activity where request_id = '${reqId}' and action = 'approval_requested' order by created_at desc limit 1`)).toBe('zoho_transfer')
    expect(sql(`select count(*) from request_comments where request_id = '${reqId}' and body like 'APPROVAL SENT FROM CK DESK%'`)).toBe('1')
  })

  skip('a second try changes nothing', async () => {
    const { sendMovedApprovals, previewMovedApprovals } = await import('@/lib/zoho/transfer/approvals')
    const apprNotes = notesFor(approverId)
    const [t] = await previewMovedApprovals(orgId, [zohoNo])
    expect(t.ready).toBe(false)
    expect(t.problems.join(' ')).toMatch(/already has an approval/)
    const [r] = await sendMovedApprovals({ orgId, actorId, actorName: 'Test Admin', numbers: [zohoNo] })
    expect(r.ok).toBe(false)
    expect(notesFor(approverId)).toBe(apprNotes)
    expect(sql(`select count(*) from approvals where request_id = '${reqId}'`)).toBe('1')
  })

  skip('refuses a ticket that is not a moved ticket waiting for approval', async () => {
    const { sendMovedApprovals } = await import('@/lib/zoho/transfer/approvals')
    const [r] = await sendMovedApprovals({ orgId, actorId, actorName: 'Test Admin', numbers: [999999992] })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/not a moved ticket/)
  })
})
