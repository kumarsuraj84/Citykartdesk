#!/usr/bin/env node
// Phase 4/6: creates the controlled load-test organization structure
// (department, 6 teams, services/categories/subcategories, SLA policy,
// one business rule) inside the EXISTING bootstrap org - never a new org,
// never touching real Citykart config. Every row is tagged with RUN_ID in
// its name/slug for later forensic identification and cleanup.
//
// Usage: LOADTEST_ENV=local node loadtest/setup/create-org.mjs
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync, mkdirSync } from 'node:fs'
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
if (!RUN_ID) {
  console.error('LOADTEST_RUN_ID must be set (create-personas.mjs and every worker must share the same one).')
  process.exit(1)
}

console.log(`[loadtest] TARGET=${env.toUpperCase()} runId=${RUN_ID}`)

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const BOOTSTRAP_ORG_ID = '00000000-0000-0000-0000-000000000001'
const TEAM_COUNT = 6

async function main() {
  const { data: dept, error: deptErr } = await admin
    .from('departments')
    .insert({ name: `${RUN_ID} Department`, org_id: BOOTSTRAP_ORG_ID })
    .select('id').single()
  if (deptErr || !dept) throw new Error(`department: ${deptErr?.message}`)

  const { data: slaPolicy, error: slaErr } = await admin
    .from('sla_policies')
    .insert({
      org_id: BOOTSTRAP_ORG_ID,
      name: `${RUN_ID} SLA Policy`,
      config: {
        low: { response_hours: 24, resolution_hours: 48 },
        medium: { response_hours: 8, resolution_hours: 16 },
        high: { response_hours: 4, resolution_hours: 8 },
        urgent: { response_hours: 1, resolution_hours: 2 },
      },
    })
    .select('id').single()
  if (slaErr || !slaPolicy) throw new Error(`sla_policy: ${slaErr?.message}`)

  const teams = []
  for (let i = 0; i < TEAM_COUNT; i++) {
    const prefix = `L${i}${RUN_ID.slice(-4)}`.slice(0, 6).toUpperCase()
    const { data: team, error: teamErr } = await admin
      .from('teams')
      .insert({ name: `${RUN_ID} Team ${i + 1}`, slug: `${RUN_ID.toLowerCase()}-team-${i + 1}`, prefix, department_id: dept.id, org_id: BOOTSTRAP_ORG_ID })
      .select('id').single()
    if (teamErr || !team) throw new Error(`team ${i}: ${teamErr?.message}`)
    teams.push(team.id)
  }

  const { data: category, error: catErr } = await admin
    .from('service_categories')
    .insert({ name: `${RUN_ID} Category`, slug: `${RUN_ID.toLowerCase()}-category`, org_id: BOOTSTRAP_ORG_ID })
    .select('id').single()
  if (catErr || !category) throw new Error(`category: ${catErr?.message}`)

  // service_sub_category_tags.sub_category_id is uniquely constrained - a
  // sub-category belongs to exactly one service. So each of the 6 services
  // gets its OWN 4 sub-categories (24 total), not 4 shared across all 6.
  const SUBCATS = ['Hardware Issue', 'Software Issue', 'Access Request', 'General Query']
  const services = []
  const subCategories = []
  for (let i = 0; i < TEAM_COUNT; i++) {
    const { data: service, error: serviceErr } = await admin
      .from('services')
      .insert({
        name: `${RUN_ID} Service ${i + 1}`,
        slug: `${RUN_ID.toLowerCase()}-service-${i + 1}`,
        team_id: teams[i],
        org_id: BOOTSTRAP_ORG_ID,
        default_priority: 'medium',
        sla_policy_id: slaPolicy.id,
        status: 'published',
        is_active: true,
        form_fields: [],
        form_sections: [{
          id: 'sec1', title: 'Details', order: 0,
          fields: [{ id: 'description_field', type: 'textarea', label: 'Description', required: true, order: 0 }],
        }],
      })
      .select('id').single()
    if (serviceErr || !service) throw new Error(`service ${i}: ${serviceErr?.message}`)
    services.push(service.id)

    for (const name of SUBCATS) {
      const { data: sub, error: subErr } = await admin
        .from('service_sub_categories')
        .insert({ name: `${RUN_ID} ${name} (Svc${i + 1})`, slug: `${RUN_ID.toLowerCase()}-svc${i + 1}-${name.toLowerCase().replace(/\s+/g, '-')}`, category_id: category.id, is_active: true, sla_priority: 'medium' })
        .select('id').single()
      if (subErr || !sub) throw new Error(`subcat ${name} svc${i}: ${subErr?.message}`)
      const { error: tagErr } = await admin.from('service_sub_category_tags').insert({ service_id: service.id, sub_category_id: sub.id })
      if (tagErr) throw new Error(`tag service ${i} / ${sub.id}: ${tagErr.message}`)
      subCategories.push({ id: sub.id, serviceId: service.id })
    }
  }

  const manifest = {
    runId: RUN_ID,
    env,
    orgId: BOOTSTRAP_ORG_ID,
    departmentId: dept.id,
    slaPolicyId: slaPolicy.id,
    categoryId: category.id,
    // Each entry's subCategoryIds belong ONLY to that service (a
    // sub-category cannot be shared across services - see the unique
    // constraint note above).
    services: services.map((serviceId) => ({
      serviceId,
      subCategoryIds: subCategories.filter((s) => s.serviceId === serviceId).map((s) => s.id),
    })),
    teamIds: teams,
    serviceIds: services,
    createdAt: new Date().toISOString(),
  }
  const dir = path.resolve(__dirname, '../results', RUN_ID)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'org-manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`[loadtest] Org structure created: ${teams.length} teams, ${services.length} services, ${subCategories.length} sub-categories.`)
  console.log(`[loadtest] Manifest: ${path.join(dir, 'org-manifest.json')}`)
}

main().catch((err) => { console.error('create-org failed:', err); process.exit(1) })
