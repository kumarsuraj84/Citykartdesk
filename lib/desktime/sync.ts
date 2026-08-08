import { createAdminClient } from '@/lib/supabase/admin'
import { getOrgDeskTimeApiKey, fetchEmployees, fetchEmployeeProjects, fetchEmployeeApps, isoDate } from './api'
import type { Database } from '@/types/database'

type TimeLogInsert = Database['public']['Tables']['desktime_time_logs']['Insert']
type AppLogInsert = Database['public']['Tables']['desktime_app_logs']['Insert']

// Pulls per-employee, per-project and per-application tracked time for a
// range of days and stores it in desktime_time_logs / desktime_app_logs,
// matching DeskTime project names to this org's project names
// (punctuation-insensitive). Ported from the org's own internal DeskTime
// integration.

export interface DeskTimeSyncResult {
  days: number
  rows: number
  matched: number
  employees: number
  apps: number
}

// Punctuation-insensitive key so "WMS System – Production" and
// "WMS system-production" match.
function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

async function recordSyncFailure(orgId: string, message: string, triggeredBy: string) {
  const admin = createAdminClient()
  await admin.from('desktime_sync_runs').insert({
    org_id: orgId,
    status: 'error',
    triggered_by: triggeredBy,
    message: message.slice(0, 500),
  })
}

export async function runDeskTimeSync(orgId: string, days: number, triggeredBy: string): Promise<DeskTimeSyncResult> {
  const span = Math.min(Math.max(Math.round(days) || 1, 1), 31)
  const admin = createAdminClient()

  try {
    const apiKey = await getOrgDeskTimeApiKey(orgId)
    if (!apiKey) throw new Error('DeskTime is not connected for this organisation.')

    const { data: projects, error: pErr } = await admin.from('projects').select('id, name').eq('org_id', orgId)
    if (pErr) throw new Error(pErr.message)
    const { data: overrides, error: mErr } = await admin.from('desktime_project_map').select('desktime_key, project_id').eq('org_id', orgId)
    if (mErr) throw new Error(mErr.message)

    // Manual mappings win over name matching; a mapped row with no project means "ignore".
    const manual = new Map<string, string | null>()
    for (const row of overrides ?? []) manual.set(row.desktime_key, row.project_id)

    const candidates = (projects ?? []).map((p) => ({ id: p.id, key: normalizeName(p.name) }))
    const matchProject = (desktimeName: string): string | null => {
      const key = normalizeName(desktimeName)
      if (!key) return null
      if (manual.has(key)) return manual.get(key) ?? null
      const exact = candidates.find((c) => c.key === key)
      if (exact) return exact.id
      // Tracker names often carry extra detail ("WMS" -> "WMS System – Production").
      const prefixed = candidates.filter((c) => c.key.startsWith(key)).sort((a, b) => a.key.length - b.key.length)
      if (prefixed.length) return prefixed[0].id
      const contained = candidates
        .filter((c) => c.key.includes(key) || key.includes(c.key))
        .sort((a, b) => a.key.length - b.key.length)
      return contained.length ? contained[0].id : null
    }

    const rows: TimeLogInsert[] = []
    const appRows: AppLogInsert[] = []
    const seenEmployees = new Set<string>()
    const seenProjectNames = new Map<string, string>()
    let matched = 0

    for (let i = 0; i < span; i++) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - i)
      const date = isoDate(d)

      const employees = await fetchEmployees(apiKey, date)
      for (const emp of employees) {
        seenEmployees.add(emp.id)
        const memberName = emp.name || `Employee ${emp.id}`
        const entries = await fetchEmployeeProjects(apiKey, emp.id, date)
        for (const entry of entries) {
          const projectId = matchProject(entry.projectName)
          if (projectId) matched++
          const key = normalizeName(entry.projectName)
          if (key && !seenProjectNames.has(key)) seenProjectNames.set(key, entry.projectName)
          rows.push({
            org_id: orgId,
            work_date: date,
            project_id: projectId,
            desktime_project_id: entry.projectId || entry.projectName,
            desktime_project_name: entry.projectName,
            desktime_user_id: emp.id,
            member_name: memberName,
            member_email: emp.email,
            minutes: entry.minutes,
            updated_at: new Date().toISOString(),
          })
        }

        const apps = await fetchEmployeeApps(apiKey, emp.id, date)
        for (const app of apps) {
          appRows.push({
            org_id: orgId,
            work_date: date,
            desktime_user_id: emp.id,
            member_name: memberName,
            member_email: emp.email,
            app_name: app.appName,
            app_type: app.appType,
            productivity: app.productivity,
            minutes: app.minutes,
            updated_at: new Date().toISOString(),
          })
        }
      }
    }

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from('desktime_time_logs').upsert(rows.slice(i, i + 500), { onConflict: 'work_date,desktime_user_id,desktime_project_id' })
      if (error) throw new Error(error.message)
    }
    for (let i = 0; i < appRows.length; i += 500) {
      const { error } = await admin.from('desktime_app_logs').upsert(appRows.slice(i, i + 500), { onConflict: 'work_date,desktime_user_id,app_name' })
      if (error) throw new Error(error.message)
    }

    // Keep the manual mapping screen populated with every DeskTime project seen.
    const discovered = [...seenProjectNames.entries()].map(([key, name]) => ({
      org_id: orgId,
      desktime_key: key,
      desktime_project_name: name,
      project_id: matchProject(name),
    }))
    if (discovered.length) {
      await admin.from('desktime_project_map').upsert(discovered, { onConflict: 'org_id,desktime_key', ignoreDuplicates: true })
    }

    const result: DeskTimeSyncResult = {
      days: span,
      rows: rows.length,
      matched,
      employees: seenEmployees.size,
      apps: appRows.length,
    }

    await admin.from('desktime_sync_runs').insert({
      org_id: orgId,
      status: 'success',
      days_synced: result.days,
      rows_upserted: result.rows,
      matched_projects: result.matched,
      triggered_by: triggeredBy,
      message: `${result.employees} employees processed · ${result.apps} app entries`,
    })

    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown DeskTime sync error.'
    await recordSyncFailure(orgId, message, triggeredBy)
    throw err
  }
}

// Re-applies the current manual mapping + name matching to all stored
// project time, without re-fetching from DeskTime (used after an admin
// edits the Project mapping tab).
export async function remapDeskTimeProjects(orgId: string): Promise<{ updated: number }> {
  const admin = createAdminClient()

  const { data: maps, error } = await admin.from('desktime_project_map').select('desktime_key, project_id').eq('org_id', orgId)
  if (error) throw new Error(error.message)

  const { data: logs, error: lErr } = await admin
    .from('desktime_time_logs')
    .select('id, desktime_project_name, project_id')
    .eq('org_id', orgId)
  if (lErr) throw new Error(lErr.message)

  const manual = new Map<string, string | null>()
  for (const row of maps ?? []) manual.set(row.desktime_key, row.project_id)

  let updated = 0
  for (const log of logs ?? []) {
    const key = normalizeName(log.desktime_project_name)
    if (!manual.has(key)) continue
    const target = manual.get(key) ?? null
    if (target === log.project_id) continue
    const { error: uErr } = await admin.from('desktime_time_logs').update({ project_id: target }).eq('id', log.id)
    if (uErr) throw new Error(uErr.message)
    updated++
  }
  return { updated }
}
