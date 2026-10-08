// AUDIT: every number the dashboards show, checked against the raw ticket data.
//
// The "truth" below is worked out with plain SQL straight on the tables (no application code), then compared with:
//   - the normal Dashboards page (lib/queries/analytics.ts getAnalytics)
//   - the Smart Dashboard (lib/queries/executive-dashboard.ts + lib/reporting/executive/engine.ts)
// It runs against the LOCAL database only (it refuses anything else) and works on whatever data is there.

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { execFileSync } from 'child_process'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v

const DB = 'supabase_db_citykart_desk'
const sql = (q: string): unknown => {
  const out = execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-tA', '-c', q], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return JSON.parse(out.trim())
}

// the moment a ticket counts as resolved: resolved_at, else closed_at, else (status says resolved/closed) its last update
const RES = "coalesce(resolved_at, closed_at, case when status in ('resolved','closed') then updated_at end)"

interface Truth {
  created: number; createdByStatus: Record<string, number>; createdByPriority: Record<string, number>; createdByGroup: Record<string, number>
  resolved: number; resolvedByGroup: Record<string, number>
  openNow: number; openByGroup: Record<string, number>; breachedNow: number
  slaBase: number; slaMet: number; tatAvgH: number | null; frtAvgH: number | null
  aging: Record<string, number>
}

function truth(org: string, s: string, e: string, now: string): Truth {
  const w = (col: string) => `${col} >= '${s}' and ${col} <= '${e}'`
  const kv = (rows: string) => `(select coalesce(json_object_agg(k, c), '{}'::json) from (${rows}) x)`
  const q = `select json_build_object(
    'created', (select count(*) from requests where org_id='${org}' and ${w('created_at')}),
    'createdByStatus', ${kv(`select status::text k, count(*) c from requests where org_id='${org}' and ${w('created_at')} group by 1`)},
    'createdByPriority', ${kv(`select priority::text k, count(*) c from requests where org_id='${org}' and ${w('created_at')} group by 1`)},
    'createdByGroup', ${kv(`select t.name k, count(*) c from requests r join teams t on t.id=r.team_id where r.org_id='${org}' and ${w('r.created_at')} group by 1`)},
    'resolved', (select count(*) from requests where org_id='${org}' and ${w(RES)}),
    'resolvedByGroup', ${kv(`select t.name k, count(*) c from requests r join teams t on t.id=r.team_id where r.org_id='${org}' and ${w(RES.replace(/\b(resolved_at|closed_at|status|updated_at)\b/g, 'r.$1'))} group by 1`)},
    'openNow', (select count(*) from requests where org_id='${org}' and status not in ('resolved','closed','cancelled')),
    'openByGroup', ${kv(`select t.name k, count(*) c from requests r join teams t on t.id=r.team_id where r.org_id='${org}' and r.status not in ('resolved','closed','cancelled') group by 1`)},
    'breachedNow', (select count(*) from requests where org_id='${org}' and status not in ('resolved','closed','cancelled') and resolution_due_at < '${now}'),
    'slaBase', (select count(*) from requests where org_id='${org}' and ${w(RES)} and resolution_due_at is not null),
    'slaMet', (select count(*) from requests where org_id='${org}' and ${w(RES)} and resolution_due_at is not null and ${RES} <= resolution_due_at),
    'tatAvgH', (select avg(extract(epoch from (${RES} - created_at))/3600) from requests where org_id='${org}' and ${w(RES)} and ${RES} >= created_at),
    'frtAvgH', (select avg(extract(epoch from (responded_at - created_at))/3600) from requests where org_id='${org}' and ${w('created_at')} and responded_at is not null and responded_at >= created_at),
    'aging', ${kv(`select case
         when extract(epoch from ('${now}'::timestamptz - created_at))/86400 <= 5 then '0–5 days'
         when extract(epoch from ('${now}'::timestamptz - created_at))/86400 <= 10 then '6–10 days'
         when extract(epoch from ('${now}'::timestamptz - created_at))/86400 <= 20 then '11–20 days'
         when extract(epoch from ('${now}'::timestamptz - created_at))/86400 <= 30 then '21–30 days'
         when extract(epoch from ('${now}'::timestamptz - created_at))/86400 <= 45 then '31–45 days'
         when extract(epoch from ('${now}'::timestamptz - created_at))/86400 <= 60 then '46–60 days'
         when extract(epoch from ('${now}'::timestamptz - created_at))/86400 <= 75 then '61–75 days'
         when extract(epoch from ('${now}'::timestamptz - created_at))/86400 <= 90 then '76–90 days'
         else '90+ days' end k, count(*) c from requests where org_id='${org}' and status not in ('resolved','closed','cancelled') group by 1`)}
  )`
  return sql(q) as Truth
}

const num = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d)

// stable text form (object keys sorted) so {a:1,b:2} equals {b:2,a:1}
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x))

interface Truth2 {
  byPriority: Record<string, { resolved: number; slaBase: number; slaMet: number }>
  agents: Record<string, { resolved: number; open: number }>
  approvals: { approved: number; rejected: number; pending: number }
}

function truth2(org: string, s: string, e: string): Truth2 {
  const w = `${RES} >= '${s}' and ${RES} <= '${e}'`
  const q = `select json_build_object(
    'byPriority', (select coalesce(json_object_agg(p, json_build_object('resolved', r, 'slaBase', b, 'slaMet', m)), '{}'::json) from (
        select priority::text p, count(*) r, count(*) filter (where resolution_due_at is not null) b,
               count(*) filter (where resolution_due_at is not null and ${RES} <= resolution_due_at) m
        from requests where org_id='${org}' and ${w} group by 1) x),
    'agents', (select coalesce(json_object_agg(a, json_build_object('resolved', r, 'open', o)), '{}'::json) from (
        select assigned_to::text a,
               count(*) filter (where ${w}) r,
               count(*) filter (where status not in ('resolved','closed','cancelled')) o
        from requests where org_id='${org}' and assigned_to is not null group by 1) x where r > 0 or o > 0),
    'approvals', (select json_build_object(
        'approved', count(*) filter (where a.status='approved' and fin >= '${s}' and fin <= '${e}'),
        'rejected', count(*) filter (where a.status='rejected' and fin >= '${s}' and fin <= '${e}'),
        'pending',  count(*) filter (where a.status='pending' and a.created_at <= '${e}'))
      from (select a.*, coalesce((select max(d.decided_at) from approval_decisions d where d.approval_id=a.id), a.created_at) fin
            from approvals a join requests r on r.id=a.request_id where r.org_id='${org}') a)
  )`
  return sql(q) as Truth2
}

describe('dashboard numbers vs the raw data (local database)', () => {
  it('reconciles every shared figure', async () => {
    expect(process.env.SUPABASE_URL).toMatch(/127\.0\.0\.1|localhost/)
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { getAnalytics } = await import('@/lib/queries/analytics')
    const { loadExecutiveData } = await import('@/lib/queries/executive-dashboard')
    const E = await import('@/lib/reporting/executive/engine')
    const admin = createAdminClient()

    const { data: owner } = await admin.from('profiles').select('*, team_members(team_id, is_lead, joined_at, team:teams(*))').eq('role', 'platform_owner').limit(1).single()
    const orgId = owner!.org_id as string
    const report: string[] = []
    const problems: string[] = []
    const check = (label: string, expected: unknown, actual: unknown, tol = 0) => {
      const ok = typeof expected === 'number' && typeof actual === 'number' ? Math.abs(expected - actual) <= tol : stable(expected) === stable(actual)
      report.push(`${ok ? 'ok  ' : 'DIFF'} ${label}: truth=${JSON.stringify(expected)} shown=${JSON.stringify(actual)}`)
      if (!ok) problems.push(label)
    }

    for (const period of ['30d', '60d', '90d', '120d', 'fy'] as const) {
      const now = new Date()
      const startOf = (daysBack: number) => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - daysBack); return d }
      const n = period === 'fy' ? Math.round((startOf(0).getTime() - new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1).getTime()) / 86_400_000) + 1 : Number.parseInt(period, 10)
      const strict = { s: startOf(n - 1).toISOString(), e: now.toISOString() }          // N calendar days including today

      // ── Smart Dashboard: judged against the strict window ──
      const T = truth(orgId, strict.s, strict.e, now.toISOString())
      const data = await loadExecutiveData(owner as never)
      if ('error' in data) throw new Error(data.error)
      const W = E.periodWindow(period, data.now)
      check(`[${period}] Smart window starts`, strict.s.slice(0, 16), new Date(W.start).toISOString().slice(0, 16))
      check(`[${period}] Smart created`, T.created, E.measure(data.tickets, W, 'created'))
      check(`[${period}] Smart resolved (resolved in period)`, T.resolved, E.measure(data.tickets, W, 'resolved'))
      check(`[${period}] Smart open backlog`, T.openNow, E.measure(data.tickets, W, 'backlog'))
      check(`[${period}] Smart currently breached`, T.breachedNow, E.measure(data.tickets, W, 'breaches'))
      check(`[${period}] Smart SLA %`, T.slaBase ? num((100 * T.slaMet) / T.slaBase) : null, num(E.measure(data.tickets, W, 'sla')))
      check(`[${period}] Smart avg resolution h`, num(T.tatAvgH), num(E.measure(data.tickets, W, 'tat')))
      check(`[${period}] Smart avg first response h`, num(T.frtAvgH), num(E.measure(data.tickets, W, 'frt')))
      const stat = Object.fromEntries(Object.keys(T.createdByStatus).map((st) => [st, data.tickets.filter((t) => E.inWin(t.created, W) && t.status === st).length]))
      check(`[${period}] Smart created by status`, T.createdByStatus, stat)
      const pr = Object.fromEntries(Object.keys(T.createdByPriority).map((p) => [p, data.tickets.filter((t) => E.inWin(t.created, W) && t.prio === p).length]))
      check(`[${period}] Smart created by priority`, T.createdByPriority, pr)
      const ag: Record<string, number> = {}
      for (const t of data.tickets) if (E.openAt(t, data.now)) { const k = E.ageBucketOf(t, data.now); ag[k] = (ag[k] ?? 0) + 1 }
      check(`[${period}] Smart backlog age buckets`, T.aging, ag)
      const byGroup = Object.fromEntries(Object.keys(T.createdByGroup).map((g) => [g, E.measure(data.tickets.filter((t) => t.group === g), W, 'created')]))
      check(`[${period}] Smart created by group`, T.createdByGroup, byGroup)
      const openByGroup = Object.fromEntries(Object.keys(T.openByGroup).map((g) => [g, E.measure(data.tickets.filter((t) => t.group === g), W, 'backlog')]))
      check(`[${period}] Smart open by group`, T.openByGroup, openByGroup)

      // ── Smart approvals / priority / agents ──
      const T2 = truth2(orgId, strict.s, strict.e)
      check(`[${period}] Smart approvals approved`, T2.approvals.approved, E.approvalMeasure(data.approvals as never, W, 'approved'))
      check(`[${period}] Smart approvals rejected`, T2.approvals.rejected, E.approvalMeasure(data.approvals as never, W, 'rejected'))
      check(`[${period}] Smart approvals waiting`, T2.approvals.pending, E.approvalMeasure(data.approvals as never, W, 'pending'))

      // ── Normal Dashboards page: same window, same definitions ──
      const A = await getAnalytics(orgId, period)
      check(`[${period}] Normal Created`, T.created, A.totalCreated)
      check(`[${period}] Normal Resolved (resolved in period)`, T.resolved, A.totalResolved)
      check(`[${period}] Normal Open Now`, T.openNow, A.totalOpenNow)
      check(`[${period}] Normal Currently Breached`, T.breachedNow, A.slaBreachedNow)
      check(`[${period}] Normal SLA %`, T.slaBase ? Math.round((100 * T.slaMet) / T.slaBase) : null, A.slaComplianceRate)
      check(`[${period}] Normal avg resolution h`, num(T.tatAvgH), num(A.avgResolutionHours))
      check(`[${period}] Normal avg first response h`, num(T.frtAvgH), num(A.avgFirstResponseHours))
      check(`[${period}] Normal status counts`, T.createdByStatus, Object.fromEntries(A.byStatus.map((x) => [x.status, x.count])))
      check(`[${period}] Normal backlog aging`, T.aging, Object.fromEntries(A.backlogAging.filter((b) => b.count).map((b) => [b.label, b.count])))
      check(`[${period}] Normal group volume`, T.createdByGroup, Object.fromEntries(A.byTeam.filter((x) => x.volume).map((x) => [x.teamName, x.volume])))
      check(`[${period}] Normal group resolved`, T.resolvedByGroup, Object.fromEntries(A.byTeam.filter((x) => x.resolved).map((x) => [x.teamName, x.resolved])))
      check(`[${period}] Normal group open now`, T.openByGroup, Object.fromEntries(A.byTeam.filter((x) => x.openNow).map((x) => [x.teamName, x.openNow])))
      check(`[${period}] Normal priority resolved / SLA`, T2.byPriority, Object.fromEntries(A.byPriority.filter((x) => x.resolved).map((x) => [x.priority, { resolved: x.resolved, slaBase: x.slaBase, slaMet: x.slaCompliant }])))
      const topAgents = Object.fromEntries(A.agentLeaderboard.map((x) => [x.agentId, { resolved: x.resolved, open: x.openNow }]))
      check(`[${period}] Normal agent leaderboard`, Object.fromEntries(Object.keys(topAgents).map((id) => [id, T2.agents[id] ?? { resolved: 0, open: 0 }])), topAgents)
      check(`[${period}] Normal approvals`, T2.approvals, { approved: A.approvalsApproved, rejected: A.approvalsRejected, pending: A.approvalsPending })
    }
    console.log('\n' + report.join('\n') + `\n\n${problems.length} differences\n`)
    expect(problems).toEqual([])
  }, 300000)
})
