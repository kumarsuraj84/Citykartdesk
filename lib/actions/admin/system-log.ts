'use server'

import { getCurrentProfile } from '@/lib/queries/profiles'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { toCSV } from '@/lib/export/csv'
import { recordAudit } from '@/lib/syslog/audit'
import { buildClaudeBundle, groupErrors, type ErrorGroup, type LogRowLite } from '@/lib/syslog/bundle'
import { CATEGORIES, SEVERITIES, SOURCES, OUTCOMES, SYSTEM_LOG_PAGE_SIZE } from '@/lib/syslog/shape'
import { istStamp } from '@/lib/reporting/ist'

// The System Log screen. Reads go through the signed-in administrator's OWN session, so row security (administrators and platform owners of
// the same organization only) is what limits them, not just the checks here.

export interface SystemLogFilters {
  days: number
  category?: string
  source?: string
  /** "all", or a minimum: "warning", "error", "critical" */
  minSeverity?: string
  outcome?: string
  userId?: string
  entityType?: string
  q?: string
  /** "click" = followed a click, "no_click" = did not */
  click?: string
  fingerprint?: string
  requestId?: string
}

export interface SystemLogEntry {
  id: number
  created_at: string
  category: string
  source: string
  severity: string
  outcome: string
  action: string
  actor_id: string | null
  actor_name: string
  actor_role: string | null
  entity_type: string | null
  entity_id: string | null
  entity_label: string | null
  message: string | null
  error_code: string | null
  stack: string | null
  fingerprint: string | null
  path: string | null
  method: string | null
  request_id: string | null
  correlation_id: string | null
  session_id: string | null
  ip: string | null
  user_agent: string | null
  from_click: boolean | null
  click_target: string | null
  before_data: unknown
  after_data: unknown
  detail: unknown
  row_hash: string | null
}

const EXPORT_LIMIT = 50_000
const GROUP_SCAN_LIMIT = 5000
const COLUMNS = 'id, created_at, category, source, severity, outcome, action, actor_id, actor_role, entity_type, entity_id, entity_label, message, error_code, stack, fingerprint, path, method, request_id, correlation_id, session_id, ip, user_agent, from_click, click_target, before_data, after_data, detail, row_hash'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }
const userClient = async () => (await createClient()) as unknown as AnyClient

async function requireAdmin() {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) throw new Error('Unauthorized.')
  if (!profile.org_id) throw new Error('Your account is not linked to an organisation.')
  return profile
}

const SEVERITY_AT_LEAST: Record<string, string[]> = {
  warning: ['warning', 'error', 'critical'],
  error: ['error', 'critical'],
  critical: ['critical'],
}
const safeText = (q: string) => q.trim().replace(/[%,()*\\]/g, ' ').slice(0, 80)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(query: any, f: SystemLogFilters, orgId: string, forceCategory?: string) {
  const days = Math.min(Math.max(Math.floor(f.days) || 7, 1), 365)
  query = query.eq('org_id', orgId).gte('created_at', new Date(Date.now() - days * 86_400_000).toISOString())
  const category = forceCategory ?? f.category
  if (category && (CATEGORIES as readonly string[]).includes(category)) query = query.eq('category', category)
  if (f.source && (SOURCES as readonly string[]).includes(f.source)) query = query.eq('source', f.source)
  if (f.outcome && (OUTCOMES as readonly string[]).includes(f.outcome)) query = query.eq('outcome', f.outcome)
  if (f.minSeverity && SEVERITY_AT_LEAST[f.minSeverity]) query = query.in('severity', SEVERITY_AT_LEAST[f.minSeverity])
  else if (f.minSeverity && (SEVERITIES as readonly string[]).includes(f.minSeverity)) query = query.eq('severity', f.minSeverity)
  if (f.userId) query = query.eq('actor_id', f.userId)
  if (f.entityType) query = query.eq('entity_type', safeText(f.entityType))
  if (f.click === 'click') query = query.eq('from_click', true)
  if (f.click === 'no_click') query = query.or('from_click.is.null,from_click.eq.false')
  if (f.fingerprint) query = query.eq('fingerprint', safeText(f.fingerprint))
  if (f.requestId) query = query.eq('request_id', safeText(f.requestId))
  if (f.q?.trim()) {
    const q = safeText(f.q)
    query = query.or(`action.ilike.%${q}%,message.ilike.%${q}%,path.ilike.%${q}%,entity_label.ilike.%${q}%,error_code.ilike.%${q}%,entity_id.ilike.%${q}%`)
  }
  return query
}

async function withNames(rows: Omit<SystemLogEntry, 'actor_name'>[]): Promise<SystemLogEntry[]> {
  const ids = [...new Set(rows.map((r) => r.actor_id).filter((v): v is string => !!v))]
  const names = new Map<string, string>()
  if (ids.length) {
    const supabase = await userClient()
    const { data } = await supabase.from('profiles').select('id, full_name').in('id', ids)
    for (const p of (data ?? []) as { id: string; full_name: string | null }[]) names.set(p.id, p.full_name ?? '')
  }
  return rows.map((r) => ({ ...r, actor_name: (r.actor_id && names.get(r.actor_id)) || '' }))
}

export async function listSystemLog(filters: SystemLogFilters, page = 0): Promise<{ rows: SystemLogEntry[]; hasMore: boolean; error?: string }> {
  try {
    const profile = await requireAdmin()
    const supabase = await userClient()
    const from = Math.max(0, Math.floor(page)) * SYSTEM_LOG_PAGE_SIZE
    const query = applyFilters(supabase.from('system_log').select(COLUMNS), filters, profile.org_id!)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + SYSTEM_LOG_PAGE_SIZE) // one extra row tells whether there is a next page
    const { data, error } = await query
    if (error) return { rows: [], hasMore: false, error: 'Failed to load the log.' }
    const all = (data ?? []) as Omit<SystemLogEntry, 'actor_name'>[]
    return { rows: await withNames(all.slice(0, SYSTEM_LOG_PAGE_SIZE)), hasMore: all.length > SYSTEM_LOG_PAGE_SIZE }
  } catch (e) {
    return { rows: [], hasMore: false, error: e instanceof Error ? e.message : 'Failed to load the log.' }
  }
}

async function errorRows(filters: SystemLogFilters, orgId: string): Promise<LogRowLite[]> {
  const supabase = await userClient()
  const { data, error } = await applyFilters(
    supabase.from('system_log').select('id, created_at, category, source, severity, outcome, action, message, error_code, stack, fingerprint, path, method, request_id, actor_role, from_click, click_target, detail'),
    filters, orgId, filters.category ?? 'error',
  ).order('created_at', { ascending: false }).limit(GROUP_SCAN_LIMIT)
  if (error) throw new Error('Failed to load the log.')
  return (data ?? []) as LogRowLite[]
}

/** The same problem counted once: distinct errors with how often, when, where and for whom. */
export async function listErrorGroups(filters: SystemLogFilters): Promise<{ groups: ErrorGroup[]; scanned: number; error?: string }> {
  try {
    const profile = await requireAdmin()
    const rows = await errorRows(filters, profile.org_id!)
    return { groups: groupErrors(rows, 100), scanned: rows.length }
  } catch (e) {
    return { groups: [], scanned: 0, error: e instanceof Error ? e.message : 'Failed to load the log.' }
  }
}

const describeFilters = (f: SystemLogFilters) =>
  [f.category && `category ${f.category}`, f.source && `source ${f.source}`, f.minSeverity && f.minSeverity !== 'all' && `severity ≥ ${f.minSeverity}`, f.outcome && `outcome ${f.outcome}`, f.click === 'click' && 'after a click', f.click === 'no_click' && 'not after a click', f.q?.trim() && `search "${safeText(f.q)}"`]
    .filter(Boolean).join(', ')

/** Compact, redacted markdown of the most serious problems, to paste into a conversation. */
export async function buildErrorBundle(filters: SystemLogFilters): Promise<{ text?: string; error?: string }> {
  try {
    const profile = await requireAdmin()
    const rows = await errorRows(filters, profile.org_id!)
    const text = buildClaudeBundle({
      generatedAt: new Date(), windowDays: Math.min(Math.max(Math.floor(filters.days) || 7, 1), 365), appVersion: process.env.NEXT_PUBLIC_BUILD_ID ?? null,
      filtersText: describeFilters(filters), groups: groupErrors(rows, 100), totalRows: rows.length,
    })
    await recordAudit({ category: 'security', action: 'data.exported.system_log_bundle', entityType: 'system_log', message: `Error bundle copied (${rows.length} rows)`, actorId: profile.id, orgId: profile.org_id })
    return { text }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to build the bundle.' }
  }
}

export async function exportSystemLog(filters: SystemLogFilters, format: 'csv' | 'json'): Promise<string> {
  const profile = await requireAdmin()
  const supabase = await userClient()
  const { data, error } = await applyFilters(supabase.from('system_log').select(COLUMNS), filters, profile.org_id!)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(EXPORT_LIMIT)
  if (error) throw new Error('Failed to load the log.')
  const rows = await withNames((data ?? []) as Omit<SystemLogEntry, 'actor_name'>[])
  await recordAudit({ category: 'security', action: 'data.exported.system_log', entityType: 'system_log', message: `${rows.length} rows exported as ${format}`, after: { rows: rows.length, format, filters }, actorId: profile.id, orgId: profile.org_id })
  if (format === 'json') return JSON.stringify(rows.map((r) => ({ ...r, created_at: istStamp(r.created_at) })), null, 1)
  return toCSV(
    rows.map((r) => ({ ...r, created_at: istStamp(r.created_at), before_data: r.before_data ? JSON.stringify(r.before_data) : '', after_data: r.after_data ? JSON.stringify(r.after_data) : '', detail: r.detail ? JSON.stringify(r.detail) : '', stack: (r.stack ?? '').slice(0, 2000) })) as unknown as Record<string, unknown>[],
    [
      { key: 'created_at', label: 'Time' }, { key: 'category', label: 'Category' }, { key: 'source', label: 'Source' }, { key: 'severity', label: 'Severity' }, { key: 'outcome', label: 'Outcome' },
      { key: 'action', label: 'Action' }, { key: 'actor_name', label: 'Actor' }, { key: 'actor_role', label: 'Role' }, { key: 'entity_type', label: 'Entity type' }, { key: 'entity_id', label: 'Entity id' },
      { key: 'entity_label', label: 'Entity' }, { key: 'message', label: 'Message' }, { key: 'error_code', label: 'Error code' }, { key: 'path', label: 'Page' }, { key: 'method', label: 'Method' },
      { key: 'request_id', label: 'Request id' }, { key: 'from_click', label: 'After a click' }, { key: 'click_target', label: 'Clicked' }, { key: 'ip', label: 'Address' }, { key: 'before_data', label: 'Before' },
      { key: 'after_data', label: 'After' }, { key: 'detail', label: 'Detail' }, { key: 'stack', label: 'Stack' },
    ],
  )
}

export interface IntegrityResult { ok: boolean; checked: number; brokenId?: number; reason?: string; error?: string }

/** Re-computes the hash chain of the audit and security rows and reports the first row that does not fit. */
export async function verifyLogIntegrity(): Promise<IntegrityResult> {
  try {
    const profile = await requireAdmin()
    const admin = createAdminClient() as unknown as { rpc: (fn: string, a: object) => Promise<{ data: { broken_id: number; reason: string }[] | null; error: { message: string } | null }>; from: (t: string) => any } // eslint-disable-line @typescript-eslint/no-explicit-any
    const { data, error } = await admin.rpc('system_log_verify_chain', { p_from_seq: 0, p_limit: 500_000 })
    if (error) return { ok: false, checked: 0, error: 'The check could not be run.' }
    const { count } = await admin.from('system_log').select('id', { count: 'exact', head: true }).not('row_hash', 'is', null)
    const broken = data?.[0]
    await recordAudit({ category: 'security', action: 'system_log.integrity_checked', outcome: broken ? 'failure' : 'success', severity: broken ? 'warning' : 'info', message: broken ? `Chain broken at row ${broken.broken_id}: ${broken.reason}` : `${count ?? 0} chained rows verified`, actorId: profile.id, orgId: profile.org_id })
    return broken ? { ok: false, checked: count ?? 0, brokenId: broken.broken_id, reason: broken.reason } : { ok: true, checked: count ?? 0 }
  } catch (e) {
    return { ok: false, checked: 0, error: e instanceof Error ? e.message : 'The check could not be run.' }
  }
}
