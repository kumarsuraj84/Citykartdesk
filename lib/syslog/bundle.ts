// The "Copy for Claude" bundle: a compact, redacted text of the errors that matter, ready to paste into a conversation so they can be fixed.
// Pure (no I/O). Everything that goes in is redacted again here — tokens, keys, passwords, e-mail addresses, phone numbers — whatever the
// database holds.

import { redactText } from './shape'

export interface LogRowLite {
  id: number
  created_at: string
  category: string
  source: string
  severity: string
  outcome: string
  action: string
  message: string | null
  error_code: string | null
  stack: string | null
  fingerprint: string | null
  path: string | null
  method: string | null
  request_id: string | null
  actor_role: string | null
  from_click: boolean | null
  click_target: string | null
  detail: unknown
}

export interface ErrorGroup {
  fingerprint: string
  count: number
  firstSeen: string
  lastSeen: string
  source: string
  severity: string
  action: string
  errorCode: string | null
  message: string
  paths: string[]
  roles: string[]
  clickCount: number
  clickTargets: string[]
  sampleId: number
  sampleStack: string | null
  sampleRequestId: string | null
}

const RANK: Record<string, number> = { critical: 4, error: 3, warning: 2, info: 1, debug: 0 }

/** Group error rows by fingerprint, most serious and most frequent first. */
export function groupErrors(rows: LogRowLite[], limit = 100): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>()
  for (const r of rows) {
    const key = r.fingerprint ?? `${r.source}|${r.action}|${r.error_code ?? ''}`
    let g = groups.get(key)
    if (!g) {
      g = {
        fingerprint: key, count: 0, firstSeen: r.created_at, lastSeen: r.created_at, source: r.source, severity: r.severity, action: r.action,
        errorCode: r.error_code, message: r.message ?? r.action, paths: [], roles: [], clickCount: 0, clickTargets: [], sampleId: r.id, sampleStack: r.stack, sampleRequestId: r.request_id,
      }
      groups.set(key, g)
    }
    g.count++
    if (r.created_at < g.firstSeen) g.firstSeen = r.created_at
    if (r.created_at > g.lastSeen) { g.lastSeen = r.created_at; g.sampleId = r.id; g.sampleRequestId = r.request_id ?? g.sampleRequestId; g.sampleStack = r.stack ?? g.sampleStack }
    if ((RANK[r.severity] ?? 0) > (RANK[g.severity] ?? 0)) g.severity = r.severity
    if (r.path && !g.paths.includes(r.path) && g.paths.length < 5) g.paths.push(r.path)
    if (r.actor_role && !g.roles.includes(r.actor_role)) g.roles.push(r.actor_role)
    if (r.from_click) { g.clickCount++; if (r.click_target && !g.clickTargets.includes(r.click_target) && g.clickTargets.length < 3) g.clickTargets.push(r.click_target) }
  }
  return [...groups.values()]
    .sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0) || b.count - a.count || (a.lastSeen < b.lastSeen ? 1 : -1))
    .slice(0, limit)
}

const clipText = (s: string | null, n: number) => (s ? redactText(s).slice(0, n) : '')

/** First lines of a stack, without the framework's own frames. */
export function trimStack(stack: string | null, lines = 8): string {
  if (!stack) return ''
  return redactText(stack)
    .split('\n')
    .filter((l) => !/node_modules|node:internal|next\/dist|\.next\//.test(l))
    .slice(0, lines)
    .join('\n')
}

export interface BundleInput {
  generatedAt: Date
  windowDays: number
  appVersion?: string | null
  filtersText: string
  groups: ErrorGroup[]
  totalRows: number
  maxGroups?: number
}

/** Markdown the person can paste straight into a chat. */
export function buildClaudeBundle(i: BundleInput): string {
  const groups = i.groups.slice(0, i.maxGroups ?? 25)
  const out: string[] = []
  out.push('# Citykart Desk — error report')
  out.push('')
  out.push(`Generated ${i.generatedAt.toISOString()} · last ${i.windowDays} day(s) · ${i.totalRows} matching log rows · ${i.groups.length} distinct problems${i.groups.length > groups.length ? ` (showing the ${groups.length} most serious)` : ''}`)
  if (i.appVersion) out.push(`App build: ${i.appVersion}`)
  out.push(`Filters: ${i.filtersText || 'none'}`)
  out.push('Personal data (e-mail addresses, phone numbers) and secrets (tokens, keys, passwords) have been removed.')
  out.push('')
  if (groups.length === 0) { out.push('No errors match.'); return out.join('\n') }
  out.push('Please find the cause of each problem below, propose the smallest safe fix with a regression test, and say which ones need more information.')
  out.push('')
  groups.forEach((g, n) => {
    out.push(`## ${n + 1}. [${g.severity.toUpperCase()}] ${g.source}${g.errorCode ? ` · code ${g.errorCode}` : ''} — ${g.count}×`)
    out.push(`- What: ${clipText(g.message, 400)}`)
    out.push(`- Where: ${g.action}${g.paths.length ? ` · pages: ${g.paths.join(', ')}` : ''}`)
    out.push(`- When: first ${g.firstSeen} · last ${g.lastSeen}`)
    if (g.roles.length) out.push(`- Who (roles): ${g.roles.join(', ')}`)
    if (g.clickCount) out.push(`- Followed a click: ${g.clickCount} of ${g.count}${g.clickTargets.length ? ` (e.g. ${g.clickTargets.map((t) => clipText(t, 60)).join('; ')})` : ''}`)
    else out.push('- Not caused by a click (background, scheduled or external)')
    if (g.sampleRequestId) out.push(`- Example request id: ${g.sampleRequestId}`)
    const stack = trimStack(g.sampleStack)
    if (stack) { out.push('- Stack (trimmed):'); out.push('```'); out.push(stack); out.push('```') }
    out.push('')
  })
  return out.join('\n')
}
