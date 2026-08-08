import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/types/database'

export type AiApplication = Pick<Tables<'ai_applications'>, 'id' | 'name' | 'is_active'>
export type DeskTimeProjectMapRow = Pick<Tables<'desktime_project_map'>, 'id' | 'desktime_key' | 'desktime_project_name' | 'project_id'>
export type DeskTimeSyncRun = Tables<'desktime_sync_runs'>

export interface DeskTimeAppLogRow {
  work_date: string
  member_name: string
  app_name: string
  minutes: number
}

export interface DeskTimeMemberProjectLog {
  work_date: string
  member_name: string
  minutes: number
  project_id: string | null
  project_name: string
}

// organizations.desktime_credential_ref is a non-secret Vault pointer,
// readable via the normal org_select RLS policy.
export async function getDeskTimeConnected(orgId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase.from('organizations').select('desktime_credential_ref').eq('id', orgId).single()
  return data?.desktime_credential_ref != null
}

export async function getAiApplications(orgId: string): Promise<AiApplication[]> {
  const supabase = await createClient()
  const { data } = await supabase.from('ai_applications').select('id, name, is_active').eq('org_id', orgId).order('name')
  return data ?? []
}

export async function getDeskTimeProjectMap(orgId: string): Promise<DeskTimeProjectMapRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('desktime_project_map')
    .select('id, desktime_key, desktime_project_name, project_id')
    .eq('org_id', orgId)
    .order('desktime_project_name')
  return data ?? []
}

export async function getDeskTimeAppLogs(orgId: string, from: string, to: string): Promise<DeskTimeAppLogRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('desktime_app_logs')
    .select('work_date, member_name, app_name, minutes')
    .eq('org_id', orgId)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('minutes', { ascending: false })
    .limit(20000)
  return data ?? []
}

export async function getDeskTimeMemberProjectHours(orgId: string, from: string, to: string): Promise<DeskTimeMemberProjectLog[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('desktime_time_logs')
    .select('work_date, member_name, minutes, project_id, desktime_project_name, project:projects(name)')
    .eq('org_id', orgId)
    .gte('work_date', from)
    .lte('work_date', to)
    .limit(20000)

  return (data ?? []).map((r) => {
    const rel = r.project as { name: string } | { name: string }[] | null
    const name = Array.isArray(rel) ? rel[0]?.name : rel?.name
    return {
      work_date: r.work_date,
      member_name: r.member_name,
      minutes: r.minutes,
      project_id: r.project_id,
      project_name: name || r.desktime_project_name || 'Unmapped',
    }
  })
}

export async function getDeskTimeLastSync(orgId: string): Promise<DeskTimeSyncRun | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('desktime_sync_runs')
    .select('*')
    .eq('org_id', orgId)
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}

// getAllProjectsMini already exists in lib/queries/projects.ts and is reused
// as-is for the Project mapping tab's dropdown.
