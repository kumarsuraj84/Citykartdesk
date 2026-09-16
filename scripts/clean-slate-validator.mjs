#!/usr/bin/env node
/**
 * Read-only clean-slate validator — reports what would need attention before
 * (or after) a clean-slate reset, WITHOUT deleting or modifying anything.
 *
 * See docs/CLEAN-SLATE-SEED-MANIFEST.md for the authoritative classification
 * this script checks against (system seed vs. business/test data).
 *
 * Requires the standard Supabase env vars (reads .env.local via dotenv, same
 * as the app itself): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Usage: node scripts/clean-slate-validator.mjs [--json]
 */
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
try {
  process.loadEnvFile(path.resolve(__dirname, '../.env.local'))
} catch {
  // Fall back to whatever is already in process.env (e.g. CI-provided secrets).
}

// Node 20 (unlike Node 22+) has no global WebSocket — @supabase/supabase-js's
// RealtimeClient requires one just to construct the client, even though this
// script never subscribes to realtime. Same workaround as tests/setup/env.ts.
if (!globalThis.WebSocket) {
  globalThis.WebSocket = WebSocket
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked .env.local/.env and the shell environment).')
  process.exit(1)
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const BOOTSTRAP_ORG_ID = '00000000-0000-0000-0000-000000000001'
const jsonMode = process.argv.includes('--json')

async function count(table, filter) {
  // '*' rather than 'id' - some tables (e.g. team_members) have a composite
  // primary key and no single 'id' column, which would otherwise error.
  let q = admin.from(table).select('*', { count: 'exact', head: true })
  if (filter) q = filter(q)
  const { count: c, error } = await q
  if (error) return { table, error: error.message }
  return { table, count: c ?? 0 }
}

async function main() {
  const report = { generatedAt: new Date().toISOString(), operational: {}, testUsers: {}, systemSeed: {}, sequences: {}, bootstrap: {} }

  // ── Operational / business-data rows (should be 0 on a true clean slate) ──
  const operationalTables = [
    'requests', 'tasks', 'projects', 'approvals', 'notifications', 'request_comments',
    'request_activity', 'request_attachments', 'request_conversations', 'conversation_attachments',
    'conversation_events', 'intake_messages', 'intake_channels', 'services', 'service_categories',
    'service_sub_categories', 'teams', 'departments', 'team_members', 'stores', 'oems',
    'sla_policies', 'business_rules', 'form_templates', 'kb_articles',
  ]
  for (const t of operationalTables) {
    report.operational[t] = await count(t)
  }

  // ── Test/UAT/load-test users (profiles other than the bootstrap admin) ──
  const { data: nonBootstrapProfiles, error: profErr } = await admin
    .from('profiles')
    .select('id, full_name, org_id')
    .neq('org_id', BOOTSTRAP_ORG_ID)
  report.testUsers.profilesOutsideBootstrapOrg = profErr ? { error: profErr.message } : (nonBootstrapProfiles ?? []).length

  const { count: totalProfiles } = await admin.from('profiles').select('id', { count: 'exact', head: true })
  report.testUsers.totalProfiles = totalProfiles ?? 0

  const { count: orgCount } = await admin.from('organizations').select('id', { count: 'exact', head: true })
  report.testUsers.totalOrganizations = orgCount ?? 0

  // ── Required system seed present/missing ──
  report.systemSeed.business_hours_active = await count('business_hours', (q) => q.eq('is_active', true))
  report.systemSeed.sla_escalation_rules = await count('sla_escalation_rules')
  report.systemSeed.alert_rules_bootstrap_org = await count('alert_rules', (q) => q.eq('org_id', BOOTSTRAP_ORG_ID))
  report.systemSeed.task_statuses = await count('task_statuses')
  report.systemSeed.task_priorities = await count('task_priorities')
  report.systemSeed.request_priorities = await count('request_priorities')
  report.systemSeed.retention_policies = await count('retention_policies')
  report.systemSeed.app_settings = await count('app_settings')
  report.systemSeed.org_module_access_bootstrap_org = await count('org_module_access', (q) => q.eq('org_id', BOOTSTRAP_ORG_ID))
  report.systemSeed.intake_pipeline_config_bootstrap_org = await count('intake_pipeline_config', (q) => q.eq('org_id', BOOTSTRAP_ORG_ID))

  // ── Bootstrap org + admin ──
  const { data: bootstrapOrg } = await admin.from('organizations').select('id, name, status').eq('id', BOOTSTRAP_ORG_ID).maybeSingle()
  report.bootstrap.organization = bootstrapOrg ?? null
  const { data: bootstrapAdmin } = await admin.from('profiles').select('id, full_name, role').eq('org_id', BOOTSTRAP_ORG_ID).eq('role', 'platform_owner').maybeSingle()
  report.bootstrap.platformOwnerProfile = bootstrapAdmin ?? null

  // ── Business sequences ──
  const { data: sequences } = await admin.from('request_sequences').select('prefix, last_no')
  report.sequences.request_sequences = sequences ?? []

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log('=== Clean-Slate Validator (read-only) ===')
  console.log(`Generated: ${report.generatedAt}\n`)

  console.log('-- Operational rows (expect 0 on a true clean slate) --')
  for (const [t, r] of Object.entries(report.operational)) {
    console.log(`  ${t.padEnd(28)} ${r.error ? `ERROR: ${r.error}` : r.count}`)
  }

  console.log('\n-- Users / Organizations --')
  console.log(`  totalOrganizations           ${report.testUsers.totalOrganizations} (expect 1 on a clean slate: the bootstrap org)`)
  console.log(`  totalProfiles                ${report.testUsers.totalProfiles} (expect 1 on a clean slate: the bootstrap admin)`)
  console.log(`  profilesOutsideBootstrapOrg  ${report.testUsers.profilesOutsideBootstrapOrg} (expect 0)`)

  console.log('\n-- Required system seed (should be non-zero / present) --')
  for (const [k, r] of Object.entries(report.systemSeed)) {
    console.log(`  ${k.padEnd(38)} ${r.error ? `ERROR: ${r.error}` : r.count}`)
  }

  console.log('\n-- Bootstrap --')
  console.log(`  organization: ${report.bootstrap.organization ? `${report.bootstrap.organization.name} (${report.bootstrap.organization.status})` : 'MISSING'}`)
  console.log(`  platform owner profile: ${report.bootstrap.platformOwnerProfile ? report.bootstrap.platformOwnerProfile.full_name : 'MISSING'}`)

  console.log('\n-- Business sequences --')
  for (const s of report.sequences.request_sequences) {
    console.log(`  ${s.prefix}: last_no=${s.last_no} (next ticket would be ${s.prefix}-${String(s.last_no + 1).padStart(6, '0')})`)
  }
  if (report.sequences.request_sequences.length === 0) {
    console.log('  (no rows yet — next ticket would be CKSD-000001 once one is created)')
  }
}

main().catch((err) => {
  console.error('Validator failed:', err)
  process.exit(1)
})
