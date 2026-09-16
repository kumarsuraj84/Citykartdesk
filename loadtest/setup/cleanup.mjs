#!/usr/bin/env node
// Deletes everything a create-org.mjs + create-personas.mjs + run.mjs cycle
// created for one RUN_ID, using that run's own org-manifest.json/
// personas-manifest.json as the authoritative list of ids - never a name-
// pattern guess. Never touches the bootstrap org/admin, never touches
// system-seed tables (business_hours, sla_escalation_rules, alert_rules,
// intake_pipeline_config) - see docs/CLEAN-SLATE-SEED-MANIFEST.md.
//
// Usage: LOADTEST_ENV=local LOADTEST_RUN_ID=<id> node loadtest/setup/cleanup.mjs
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import WebSocket from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
try { process.loadEnvFile(path.resolve(__dirname, '../../.env.local')) } catch {}
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket

const env = process.env.LOADTEST_ENV
if (env !== 'local' && env !== 'main') {
  console.error(`LOADTEST_ENV must be "local" or "main" (got: ${JSON.stringify(env)}). Refusing to run.`)
  process.exit(1)
}
if (env === 'main' && process.env.LOADTEST_CONFIRM_MAIN !== 'yes-run-against-main') {
  console.error('Targeting MAIN requires LOADTEST_CONFIRM_MAIN=yes-run-against-main. Refusing to run.')
  process.exit(1)
}
const RUN_ID = process.env.LOADTEST_RUN_ID
if (!RUN_ID) { console.error('LOADTEST_RUN_ID must be set.'); process.exit(1) }

console.log(`[cleanup] TARGET=${env.toUpperCase()} runId=${RUN_ID}`)

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const resultsDir = path.resolve(__dirname, '../results', RUN_ID)
const org = JSON.parse(readFileSync(path.join(resultsDir, 'org-manifest.json'), 'utf8'))
let personas = { requesters: [], technicians: [], managers: [] }
try {
  personas = JSON.parse(readFileSync(path.join(resultsDir, 'personas-manifest.json'), 'utf8'))
} catch {
  console.log('[cleanup] No personas-manifest.json found - skipping persona cleanup.')
}

const allPersonaIds = [
  ...personas.requesters.map((p) => p.id),
  ...personas.technicians.map((p) => p.id),
  ...personas.managers.map((p) => p.id),
]
const subCategoryIds = org.services.flatMap((s) => s.subCategoryIds)
const serviceIds = org.serviceIds

async function step(label, fn) {
  const { error, count } = await fn()
  if (error) throw new Error(`${label}: ${error.message}`)
  console.log(`[cleanup] ${label}: ${count ?? 'ok'}`)
}

async function main() {
  console.log(`[cleanup] Scope: department=${org.departmentId} teams=${org.teamIds.length} services=${serviceIds.length} subCategories=${subCategoryIds.length} personas=${allPersonaIds.length}`)

  // 1. requests scoped to this run's teams (cascades to comments/activity/
  //    attachments/approvals/collaborators/csat/related/sla_escalation_events;
  //    nulls out conversations/tasks/notifications/intake_reviews that
  //    referenced them - harmless, none of those flows are load-test data).
  await step('requests', () => admin.from('requests').delete({ count: 'exact' }).in('team_id', org.teamIds))

  // 2. service_sub_category_tags, then service_sub_categories
  await step('service_sub_category_tags', () => admin.from('service_sub_category_tags').delete({ count: 'exact' }).in('service_id', serviceIds))
  await step('service_sub_categories', () => admin.from('service_sub_categories').delete({ count: 'exact' }).in('id', subCategoryIds))

  // 3. services, then service_categories
  await step('services', () => admin.from('services').delete({ count: 'exact' }).in('id', serviceIds))
  await step('service_categories', () => admin.from('service_categories').delete({ count: 'exact' }).eq('id', org.categoryId))

  // 4. sla_policies (this run's own policy, not the real bootstrap one)
  await step('sla_policies', () => admin.from('sla_policies').delete({ count: 'exact' }).eq('id', org.slaPolicyId))

  // 5. team_members, then teams
  await step('team_members', () => admin.from('team_members').delete({ count: 'exact' }).in('team_id', org.teamIds))
  await step('teams', () => admin.from('teams').delete({ count: 'exact' }).in('id', org.teamIds))

  // 6. personas: profiles then auth users (profile_mobile_numbers cascades;
  //    everything else this run touched is already gone via the requests
  //    delete above). Must happen BEFORE deleting the department below -
  //    profiles.department_id -> departments has no cascade, and
  //    create-personas.mjs sets department_id on every technician/manager.
  if (allPersonaIds.length > 0) {
    const CHUNK = 200
    for (let i = 0; i < allPersonaIds.length; i += CHUNK) {
      const chunk = allPersonaIds.slice(i, i + CHUNK)
      const { error, count } = await admin.from('profiles').delete({ count: 'exact' }).in('id', chunk)
      if (error) throw new Error(`profiles chunk ${i}: ${error.message}`)
      console.log(`[cleanup] profiles chunk ${i}-${i + chunk.length}: ${count}`)
    }
    let authDeleted = 0, authErrors = 0
    for (const id of allPersonaIds) {
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error && !error.message?.includes('User not found')) authErrors++
      else authDeleted++
    }
    console.log(`[cleanup] auth.users: ${authDeleted} deleted, ${authErrors} errors`)
  }

  // 7. department (only now that no profile still references it)
  await step('departments', () => admin.from('departments').delete({ count: 'exact' }).eq('id', org.departmentId))

  console.log('[cleanup] Done.')
}

main().catch((err) => { console.error('cleanup failed:', err); process.exit(1) })
