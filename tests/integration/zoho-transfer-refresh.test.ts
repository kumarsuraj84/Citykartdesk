// "Fill in the fields of tickets already moved", against the LOCAL database (it refuses anything else). A ticket is moved, then the form is made to look as it
// would if a field had been mapped AFTER the move; the fill-in step must add the value to the EMPTY field only, add the field to the ticket's own form copy,
// leave everything else alone, notify nobody, and never overwrite a value that is already there. Needs the audit stack's demo data (otherwise NOT RUN).

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

function cleanup() {
  if (zohoNo) {
    sql(`delete from zoho_transfers where zoho_ticket_no = ${zohoNo}`)
    sql(`delete from requests where request_no = 'ZOHO-${zohoNo}'`)
  }
  sql(`delete from auth.users u where u.raw_user_meta_data->>'created_by' = 'zoho_transfer' and not exists (select 1 from requests r where r.requester_id = u.id or r.assigned_to = u.id) and not exists (select 1 from request_comments c where c.author_id = u.id) and not exists (select 1 from request_activity a where a.actor_id = u.id)`)
}

beforeAll(async () => {
  try {
    expect(process.env.SUPABASE_URL).toMatch(/127\.0\.0\.1|localhost/)
    if (Number(sql('select count(*) from zoho_map_templates')) === 0) return
    orgId = sql('select id from organizations limit 1')
    actorId = sql(`select id from profiles where role = 'admin' limit 1`)
    // a demo ticket of the template whose employee code is mapped to the CK Desk "f_contact" field, that is not already moved and not used by the other tests
    const candidates = psql('zohoaudit', `select display_id from zoho_ticket where display_id between 700020 and 700150 and template = 'Admin Issue log System' and emp_code is not null order by display_id limit 8`).split('\n').filter(Boolean).map(Number)
    const { moveZohoTickets } = await import('@/lib/zoho/transfer/move')
    for (const n of candidates) {
      const [r] = await moveZohoTickets({ orgId, actorId, numbers: [n] })
      if (r.ok) { zohoNo = n; reqId = r.requestId!; break }
      console.warn(`[zoho-transfer-refresh] ${n} not movable: ${r.reason}`)
    }
    ready = zohoNo > 0
  } catch (e) { console.warn('[zoho-transfer-refresh] setup failed:', e instanceof Error ? e.message.slice(0, 300) : e); ready = false }
}, 120_000)
afterAll(() => { if (ready) cleanup() })

const skip = (name: string, fn: () => Promise<void>) => it(name, async () => { if (!ready) return; await fn() }, 60_000)
const countNotifications = () => Number(sql('select count(*) from notifications'))

describe('filling in the fields of an already moved ticket (local database)', () => {
  it('has a movable demo ticket (otherwise the rest are NOT RUN)', () => { if (!ready) console.warn('[zoho-transfer-refresh] no movable demo ticket: tests below did not run') })

  skip('fills the EMPTY field, adds it to the ticket\'s form copy, notifies nobody, and changes nothing else', async () => {
    const { refreshMovedFields } = await import('@/lib/zoho/transfer/refresh')
    // make the ticket look as if the field was not mapped when it was moved: no value, and no definition in its own form copy
    sql(`update requests set form_data = form_data - 'f_contact', form_sections_snapshot = (select coalesce(jsonb_agg(jsonb_set(s, '{fields}', (select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(s->'fields') f where f->>'id' <> 'f_contact'))), '[]'::jsonb) from jsonb_array_elements(form_sections_snapshot) s) where id = '${reqId}'`)
    const before = sql(`select status||'|'||coalesce(assigned_to::text,'')||'|'||response_due_at||'|'||resolution_due_at||'|'||created_at from requests where id = '${reqId}'`)
    const comments = Number(sql(`select count(*) from request_comments where request_id = '${reqId}'`))
    const notes = countNotifications()
    const want = psql('zohoaudit', `select emp_code from zoho_ticket where display_id = ${zohoNo}`)

    const [res] = await refreshMovedFields({ orgId, actorId, numbers: [zohoNo] })
    expect(res.ok, res.reason).toBe(true)
    expect(res.filled.length).toBe(1)
    expect(sql(`select form_data->>'f_contact' from requests where id = '${reqId}'`)).toBe(want)
    expect(sql(`select count(*) from requests r, jsonb_array_elements(r.form_sections_snapshot) s, jsonb_array_elements(s->'fields') f where r.id = '${reqId}' and f->>'id' = 'f_contact'`)).toBe('1')
    // nothing else changed
    expect(sql(`select status||'|'||coalesce(assigned_to::text,'')||'|'||response_due_at||'|'||resolution_due_at||'|'||created_at from requests where id = '${reqId}'`)).toBe(before)
    expect(countNotifications()).toBe(notes)
    // one internal note says what was filled in
    expect(Number(sql(`select count(*) from request_comments where request_id = '${reqId}'`))).toBe(comments + 1)
    expect(sql(`select is_internal::text||'|'||left(body, 26) from request_comments where request_id = '${reqId}' and body like 'FILLED IN FROM ZOHO LATER%'`)).toBe('true|FILLED IN FROM ZOHO LATER')
  })

  skip('a second run changes nothing, and a value already on the ticket is never overwritten', async () => {
    const { refreshMovedFields } = await import('@/lib/zoho/transfer/refresh')
    const comments = Number(sql(`select count(*) from request_comments where request_id = '${reqId}'`))
    const [again] = await refreshMovedFields({ orgId, actorId, numbers: [zohoNo] })
    expect(again.ok).toBe(true)
    expect(again.filled).toEqual([])
    sql(`update requests set form_data = jsonb_set(form_data, '{f_contact}', '"KEEP-ME"') where id = '${reqId}'`)
    await refreshMovedFields({ orgId, actorId, numbers: [zohoNo] })
    expect(sql(`select form_data->>'f_contact' from requests where id = '${reqId}'`)).toBe('KEEP-ME')
    expect(Number(sql(`select count(*) from request_comments where request_id = '${reqId}'`))).toBe(comments)
  })

skip('a ticket with no technician gets the assignment rules run again (quietly); one that has a technician, or is finished, is left alone', async () => {
    const { refreshMovedFields } = await import('@/lib/zoho/transfer/refresh')
    const techId = sql(`select id from profiles where role = 'agent' limit 1`)
    sql(`delete from business_rules where name = 'ZOHO-REFRESH-TEST'`)
    const actions = JSON.stringify([{ type: 'assign', params: { strategy: 'direct', assigneeIds: [techId] } }, { type: 'notify', params: { roles: ['manager'], channels: ['in_app', 'email'], notifyAssignee: true, notifyRequester: true } }])
    const conditions = JSON.stringify([{ field: 'title', operator: 'contains', value: `#${zohoNo - 700000}` }])
    sql(`insert into business_rules (org_id, name, is_active, trigger, conditions, conditions_logic, actions, execution_order) values ('${orgId}', 'ZOHO-REFRESH-TEST', true, '{created}', '${conditions}', 'AND', '${actions}', 1)`)
    try {
      // no technician, not finished -> the rules run and assign, and nobody is notified
      sql(`update requests set assigned_to = null, status = 'open' where id = '${reqId}'`)
      const notes = countNotifications()
      const [a] = await refreshMovedFields({ orgId, actorId, numbers: [zohoNo] })
      expect(a.technician).toBe('assigned')
      expect(sql(`select assigned_to from requests where id = '${reqId}'`)).toBe(techId)
      expect(countNotifications()).toBe(notes)
      // a technician already there is never changed
      const [b] = await refreshMovedFields({ orgId, actorId, numbers: [zohoNo] })
      expect(b.technician).toBe('had')
      // a finished ticket is left alone
      sql(`update requests set assigned_to = null, status = 'resolved' where id = '${reqId}'`)
      const [c] = await refreshMovedFields({ orgId, actorId, numbers: [zohoNo] })
      expect(c.technician).toBe('finished')
      expect(sql(`select coalesce(assigned_to::text, 'none') from requests where id = '${reqId}'`)).toBe('none')
    } finally {
      sql(`delete from business_rules where name = 'ZOHO-REFRESH-TEST'`)
    }
  })

  skip('"Run automation again" (the ticket page button) works for a moved ticket that is waiting for the requester: assign only, quietly, and never a vendor mail', async () => {
    const { runCreatedAssignRules } = await import('@/lib/automation/assign-rules')
    const { loadAutomationFacts, evaluateAutomation } = await import('@/lib/automation/diagnose')
    const techId = sql(`select id from profiles where role = 'agent' limit 1`)
    sql(`delete from business_rules where name = 'ZOHO-RERUN-TEST'`)
    const actions = JSON.stringify([{ type: 'assign', params: { strategy: 'direct', assigneeIds: [techId] } }, { type: 'notify', params: { roles: ['manager'], channels: ['in_app', 'email'], notifyAssignee: true, notifyRequester: true } }])
    const conditions = JSON.stringify([{ field: 'title', operator: 'contains', value: `#${zohoNo - 700000}` }])
    sql(`insert into business_rules (org_id, name, is_active, trigger, conditions, conditions_logic, actions, execution_order) values ('${orgId}', 'ZOHO-RERUN-TEST', true, '{created}', '${conditions}', 'AND', '${actions}', 1)`)
    try {
      sql(`update requests set assigned_to = null, status = 'waiting_user' where id = '${reqId}'`)
      const admin = (await import('@/lib/supabase/admin')).createAdminClient()
      const [facts] = await loadAutomationFacts(admin as never, [reqId], { check: false })
      const d = evaluateAutomation(facts)
      expect(d.eligible).toBe(true)
      expect(d.kind).toBe('unassigned')                                           // so the button shows on the ticket page
      const notes = countNotifications()
      const r = await runCreatedAssignRules(reqId)
      expect(r.ran).toBe(true)
      expect(sql(`select assigned_to from requests where id = '${reqId}'`)).toBe(techId)
      expect(sql(`select status from requests where id = '${reqId}'`)).toBe('waiting_user')   // the status Zoho had is kept
      expect(countNotifications()).toBe(notes)                                        // nobody is told
    } finally {
      sql(`delete from business_rules where name = 'ZOHO-RERUN-TEST'`)
    }
  })

  skip('refuses a ticket that was never moved', async () => {
    const { refreshMovedFields } = await import('@/lib/zoho/transfer/refresh')
    const [res] = await refreshMovedFields({ orgId, actorId, numbers: [999999991] })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/not been moved/)
  })
})
