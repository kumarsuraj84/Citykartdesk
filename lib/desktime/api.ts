import { createAdminClient } from '@/lib/supabase/admin'

// DeskTime API v2 — server only. Endpoint shapes mirror the org's own
// proven internal DeskTime integration (employees, per-employee project
// time, per-employee app time).
const BASE = 'https://desktime.com/api/v2/json'

function toList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((v) => !!v && typeof v === 'object') as Record<string, unknown>[]
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).filter((v) => !!v && typeof v === 'object') as Record<string, unknown>[]
  }
  return []
}

function str(value: unknown): string {
  return value == null ? '' : String(value)
}

// Time fields come back in seconds; a few endpoints report minutes.
function toMinutes(record: Record<string, unknown>): number {
  const seconds = record['time'] ?? record['duration'] ?? record['trackedTime'] ?? record['projectTime']
  const n = Number(seconds)
  if (Number.isFinite(n) && n > 0) return Math.round(n / 60)
  const mins = Number(record['minutes'])
  return Number.isFinite(mins) && mins > 0 ? Math.round(mins) : 0
}

async function getJson(apiKey: string, path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('apiKey', apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' }, cache: 'no-store' })
  const text = await res.text()
  if (!res.ok) throw new Error(`DeskTime ${path} failed [${res.status}]: ${text.slice(0, 300)}`)

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`DeskTime ${path} returned a non-JSON response.`)
  }
  const err = (body as { error?: unknown })?.error
  if (err) throw new Error(`DeskTime error: ${JSON.stringify(err).slice(0, 300)}`)
  return body
}

export interface DeskTimeEmployeeRef {
  id: string
  name: string
  email: string | null
}

export async function fetchEmployees(apiKey: string, date: string): Promise<DeskTimeEmployeeRef[]> {
  const body = (await getJson(apiKey, '/employees', { date, period: 'day' })) as Record<string, unknown>
  // Shape: { employees: { "2026-08-07": { "772355": {...} } } }
  const employees = (body['employees'] ?? body) as Record<string, unknown>
  const byDate = (employees?.[date] ?? employees) as unknown
  return toList(byDate)
    .map((e) => ({
      id: str(e['id'] ?? e['userId'] ?? e['employeeId']),
      name: str(e['name'] ?? e['fullName'] ?? e['username']).trim(),
      email: (str(e['email']).trim() || null) as string | null,
    }))
    .filter((e) => e.id && e.id !== 'undefined')
}

export interface DeskTimeProjectTime {
  projectId: string
  projectName: string
  minutes: number
}

export async function fetchEmployeeProjects(apiKey: string, employeeId: string, date: string): Promise<DeskTimeProjectTime[]> {
  const body = (await getJson(apiKey, '/employee/projects', { id: employeeId, date })) as Record<string, unknown>
  const raw = toList(body['projects'] ?? (body['employee'] as Record<string, unknown> | undefined)?.['projects'])
  return raw
    .map((p) => ({
      projectId: str(p['project_id'] ?? p['id'] ?? p['projectId']),
      projectName: str(p['project_title'] ?? p['name'] ?? p['projectName'] ?? p['title']).trim(),
      minutes: toMinutes(p),
    }))
    .filter((p) => p.projectName && p.minutes > 0)
}

export interface DeskTimeAppTime {
  appName: string
  appType: string
  productivity: string
  minutes: number
}

// Per-application tracked time for one employee/day.
export async function fetchEmployeeApps(apiKey: string, employeeId: string, date: string): Promise<DeskTimeAppTime[]> {
  const body = (await getJson(apiKey, '/employee/apps', { id: employeeId, date })) as Record<string, unknown>
  const groups = (body['apps'] ?? {}) as Record<string, unknown>
  const totals = new Map<string, DeskTimeAppTime>()

  for (const [group, value] of Object.entries(groups)) {
    for (const app of toList(value)) {
      const appName = str(app['name'] ?? app['app']).trim()
      if (!appName) continue
      const minutes = toMinutes({ time: app['duration'] })
      if (minutes <= 0) continue
      const key = appName.toLowerCase()
      const existing = totals.get(key)
      if (existing) existing.minutes += minutes
      else totals.set(key, { appName, appType: str(app['type']) || 'app', productivity: group, minutes })
    }
  }
  return [...totals.values()]
}

export function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// Reads an org's DeskTime API key back out of Vault via the service-role RPC.
// Returns null if the org has never connected DeskTime.
export async function getOrgDeskTimeApiKey(orgId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data: org } = await admin.from('organizations').select('desktime_credential_ref').eq('id', orgId).single()
  if (!org?.desktime_credential_ref) return null

  const { data: apiKey, error } = await admin.rpc('org_read_desktime_key', { p_ref: org.desktime_credential_ref })
  if (error || !apiKey) return null
  return apiKey
}
