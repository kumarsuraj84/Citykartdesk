// The fixed predefined reports against the LOCAL database (it refuses anything else): every report loads, and the counts of the group reports agree with plain SQL.

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { execFileSync } from 'child_process'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v

const sql = (q: string): unknown => JSON.parse(execFileSync('docker', ['exec', 'supabase_db_citykart_desk', 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', q], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim())

const OPEN_LIST = ['open', 'assigned', 'in_progress', 'waiting_user', 'hold_purchase_ho', 'pending_approval']
const OPEN = "('open','assigned','in_progress','waiting_user','hold_purchase_ho','pending_approval')"
const res_total = (t: { columns: { key: string }[] }) => t.columns.findIndex((c) => c.key === 'total')

describe('fixed reports (local database)', () => {
  it('loads all twelve, and the Admin and BD summaries count exactly the open tickets of their groups', async () => {
    expect(process.env.SUPABASE_URL).toMatch(/127\.0\.0\.1|localhost/)
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { loadFixedReport } = await import('@/lib/queries/fixed-reports')
    const { FIXED_REPORTS } = await import('@/lib/reporting/analytics/fixed-reports')
    const { emptyReportFilter } = await import('@/lib/reporting/analytics/report-filter')
    const admin = createAdminClient()
    const { data: owner } = await admin.from('profiles').select('*, team_members(team_id, is_lead, joined_at, team:teams(*))').eq('role', 'platform_owner').limit(1).single()
    const profile = owner as never

    for (const def of FIXED_REPORTS) {
      const res = await loadFixedReport(profile, def.slug)
      expect('error' in res ? res.error : '', def.slug).toBe('')
      if ('error' in res) continue
      expect(res.table.title).toBe(def.title)
      // every number points at tickets that exist in the report
      for (const r of res.table.rows) for (const refs of r.refs) for (const i of refs ?? []) expect(res.table.tickets[i]).toBeTruthy()
    }

    const OPEN = "('open','assigned','in_progress','waiting_user','hold_purchase_ho','pending_approval')"
    for (const [slug, group] of [['admin-summary-report', 'ADMIN GROUP'], ['bd-summary-report', 'BD Group']] as const) {
      const res = await loadFixedReport(profile, slug)
      if ('error' in res) throw new Error(res.error)
      const truth = sql(`select count(*) from requests r join teams t on t.id = r.team_id where t.name = '${group}' and r.status in ${OPEN}`) as number
      const grand = res.table.rows.at(-1)
      const total = res.table.columns.findIndex((c) => c.key === 'total')
      expect(grand?.cells[total] ?? 0, slug).toBe(truth)
    }

    // the status and technician filters: a technician narrows every number to theirs, a status choice replaces the report's own statuses, and the lists they
    // offer agree with the database
    const base = await loadFixedReport(profile, 'admin-summary-report')
    if ('error' in base) throw new Error(base.error)
    const tech = base.filters.combos.find((c) => c.tech !== 'Unassigned')!.tech
    const mine = await loadFixedReport(profile, 'admin-summary-report', { ...emptyReportFilter(), techs: [tech] })
    if ('error' in mine) throw new Error(mine.error)
    const ofTech = base.filters.combos.filter((c) => c.tech === tech && OPEN_LIST.includes(c.status)).reduce((n, c) => n + c.count, 0)
    expect(mine.table.rows.at(-1)?.cells[res_total(mine.table)]).toBe(ofTech)
    expect(mine.table.rows.filter((r) => r.kind === 'row').every((r) => r.key.startsWith(tech + '|') || r.cells[0] === '' || r.cells[0] === tech)).toBe(true)
    const resolved = await loadFixedReport(profile, 'admin-summary-report', { ...emptyReportFilter(), statuses: ['resolved'] })
    if ('error' in resolved) throw new Error(resolved.error)
    const resolvedTruth = sql(`select count(*) from requests r join teams t on t.id = r.team_id where t.name = 'ADMIN GROUP' and r.status = 'resolved'`) as number
    expect(resolved.table.rows.at(-1)?.cells[res_total(resolved.table)] ?? 0).toBe(resolvedTruth)
    expect(resolved.filters.effective.statuses).toEqual(['resolved'])
    // the lists count every status of the report's scope
    const adminId = base.filters.groups.find((g) => g.name === 'ADMIN GROUP')!.id
    expect(base.filters.combos.filter((c) => c.status === 'resolved' && c.group === adminId).reduce((n, c) => n + c.count, 0)).toBe(resolvedTruth)

    // a group choice replaces the report's own group and selects all its services; a service choice narrows it
    const groupsOf = base.filters.groups
    const bd = groupsOf.find((g) => g.name === 'BD Group')
    if (bd) {
      const asBd = await loadFixedReport(profile, 'admin-summary-report', { ...emptyReportFilter(), groups: [bd.id] })
      if ('error' in asBd) throw new Error(asBd.error)
      const bdTruth = sql(`select count(*) from requests where team_id = '${bd.id}' and status in ${OPEN}`) as number
      expect(asBd.table.rows.at(-1)?.cells[res_total(asBd.table)] ?? 0).toBe(bdTruth)
      expect(asBd.filters.effective.groups).toEqual([bd.id])
    }
    const adminTeam = groupsOf.find((g) => g.name === 'ADMIN GROUP')!
    const repairSvc = base.filters.services.find((x) => x.groupId === adminTeam.id && x.name === 'ADMIN REPAIR')
    if (repairSvc) {
      const one = await loadFixedReport(profile, 'admin-summary-report', { ...emptyReportFilter(), groups: [adminTeam.id], services: [repairSvc.id] })
      if ('error' in one) throw new Error(one.error)
      const oneTruth = sql(`select count(*) from requests where service_id = '${repairSvc.id}' and status in ${OPEN}`) as number
      expect(one.table.rows.at(-1)?.cells[res_total(one.table)] ?? 0).toBe(oneTruth)
    }

    // a store-side pending report holds only tickets that are waiting on the user
    const pending = await loadFixedReport(profile, 'store-side-pending-tickets-report')
    if ('error' in pending) throw new Error(pending.error)
    const waiting = sql(`select count(*) from requests where status = 'waiting_user'`) as number
    expect(pending.table.rows.at(-1)?.cells.at(-1) ?? 0).toBe(waiting)
  }, 180_000)

  it('a technician starts on their own groups, and an admin on every group', async () => {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { loadFixedReport } = await import('@/lib/queries/fixed-reports')
    const admin = createAdminClient()
    const { data: agents } = await admin.from('profiles').select('*, team_members(team_id, is_lead, joined_at, team:teams(*))').eq('role', 'agent').limit(40)
    const tech = ((agents ?? []) as { team_members: { team_id: string; team: { is_active: boolean } | null }[] }[]).find((a) => a.team_members.some((m) => m.team?.is_active))
    expect(tech, 'a technician with a group exists in the local data').toBeTruthy()
    const mine = tech!.team_members.filter((m) => m.team?.is_active).map((m) => m.team_id)
    const res = await loadFixedReport(tech as never, 'store-side-pending-tickets-report')
    if ('error' in res) throw new Error(res.error)
    expect([...res.filters.effective.groups].sort()).toEqual([...mine].sort())
    const list = mine.map((id) => `'${id}'`).join(',')
    const truth = sql(`select count(*) from requests where status = 'waiting_user' and team_id in (${list})`) as number
    expect(res.table.rows.at(-1)?.cells.at(-1) ?? 0).toBe(truth)
    // the lists offer only their own groups
    expect(res.filters.groups.map((g) => g.id).sort()).toEqual([...mine].sort())

    const { data: owner } = await admin.from('profiles').select('*, team_members(team_id, is_lead, joined_at, team:teams(*))').eq('role', 'platform_owner').limit(1).single()
    const all = await loadFixedReport(owner as never, 'store-side-pending-tickets-report')
    if ('error' in all) throw new Error(all.error)
    expect(all.filters.effective.groups).toEqual([])
  }, 120_000)
})
