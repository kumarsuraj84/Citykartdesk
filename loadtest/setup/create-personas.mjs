#!/usr/bin/env node
// Phase 4/5: creates load-test identities - 220 requesters, 60 technicians
// (distributed 10 per team across the 6 teams create-org.mjs made), 10
// managers. No new admin account (uses the existing bootstrap platform
// owner for admin activity per the brief - "do not unnecessarily create
// many privileged accounts"). Every identity is tagged with RUN_ID in its
// email/name; never a real Citykart employee/customer identity.
//
// Usage: LOADTEST_ENV=local LOADTEST_RUN_ID=<id> node loadtest/setup/create-personas.mjs
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
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

const REQUESTER_COUNT = Number(process.env.LOADTEST_REQUESTERS || 220)
const TECHNICIAN_COUNT = Number(process.env.LOADTEST_TECHNICIANS || 60)
const MANAGER_COUNT = Number(process.env.LOADTEST_MANAGERS || 10)
const REQUESTER_OFFSET = Number(process.env.LOADTEST_REQUESTER_OFFSET || 0)
const TECHNICIAN_OFFSET = Number(process.env.LOADTEST_TECHNICIAN_OFFSET || 0)
const MANAGER_OFFSET = Number(process.env.LOADTEST_MANAGER_OFFSET || 0)
const CONCURRENCY = Number(process.env.LOADTEST_SETUP_CONCURRENCY || 12)
const PASSWORD = `LoadTest-${RUN_ID}-Pw!1`

console.log(`[loadtest] TARGET=${env.toUpperCase()} runId=${RUN_ID} requesters=${REQUESTER_COUNT} technicians=${TECHNICIAN_COUNT} managers=${MANAGER_COUNT}`)

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const manifestPath = path.resolve(__dirname, '../results', RUN_ID, 'org-manifest.json')
const orgManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

async function runWithConcurrency(items, limit, task) {
  const results = new Array(items.length)
  const errors = []
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try { results[i] = await task(items[i], i) }
      catch (err) { errors.push({ index: i, item: items[i], error: err instanceof Error ? err.message : String(err) }) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return { results, errors }
}

async function createPersona(label, fullName, index) {
  const email = `${RUN_ID.toLowerCase()}-${label}-${index}@loadtest.example.test`
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName },
  })
  // Idempotent: re-running with an overlapping index range signs in the
  // existing persona instead of failing, so a partial/retried setup never
  // loses track of personas that already exist.
  let userId = created?.user?.id
  if ((createErr || !created?.user) && !createErr?.message?.includes('already been registered')) {
    throw new Error(`createUser ${email}: ${createErr?.message}`)
  }

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInErr || !signIn.session) throw new Error(`signIn ${email}: ${signInErr?.message}`)
  userId = userId || signIn.session.user.id

  return { id: userId, email, fullName, accessToken: signIn.session.access_token, refreshToken: signIn.session.refresh_token }
}

function loadExistingManifest() {
  try {
    return JSON.parse(readFileSync(path.resolve(__dirname, '../results', RUN_ID, 'personas-manifest.json'), 'utf8'))
  } catch {
    return { requesters: [], technicians: [], managers: [] }
  }
}

async function main() {
  const existing = loadExistingManifest()

  console.log(`[loadtest] Creating requesters (offset ${REQUESTER_OFFSET}, count ${REQUESTER_COUNT})...`)
  const { results: newRequesters, errors: reqErrors } = await runWithConcurrency(
    Array.from({ length: REQUESTER_COUNT }, (_, i) => i + REQUESTER_OFFSET),
    CONCURRENCY,
    (i) => createPersona('req', `LoadTest Requester ${i}`, i)
  )
  if (reqErrors.length) console.error(`[loadtest] ${reqErrors.length} requester creation errors (first 3):`, reqErrors.slice(0, 3))

  console.log(`[loadtest] Creating technicians (offset ${TECHNICIAN_OFFSET}, count ${TECHNICIAN_COUNT})...`)
  const { results: newTechnicians, errors: techErrors } = await runWithConcurrency(
    Array.from({ length: TECHNICIAN_COUNT }, (_, i) => i + TECHNICIAN_OFFSET),
    CONCURRENCY,
    (i) => createPersona('tech', `LoadTest Technician ${i}`, i)
  )
  if (techErrors.length) console.error(`[loadtest] ${techErrors.length} technician creation errors (first 3):`, techErrors.slice(0, 3))

  console.log(`[loadtest] Creating managers (offset ${MANAGER_OFFSET}, count ${MANAGER_COUNT})...`)
  const { results: newManagers, errors: mgrErrors } = await runWithConcurrency(
    Array.from({ length: MANAGER_COUNT }, (_, i) => i + MANAGER_OFFSET),
    CONCURRENCY,
    (i) => createPersona('mgr', `LoadTest Manager ${i}`, i)
  )
  if (mgrErrors.length) console.error(`[loadtest] ${mgrErrors.length} manager creation errors (first 3):`, mgrErrors.slice(0, 3))

  // Promote NEWLY created technicians/managers to their role and distribute
  // across the 6 teams, continuing the round-robin from the current global
  // offset so re-running with an offset doesn't restart team assignment at
  // team 0 (which would just pile everyone onto the first team again).
  const teamIds = orgManifest.teamIds
  console.log('[loadtest] Promoting new technicians to agent role and assigning teams...')
  const { errors: techSetupErrors } = await runWithConcurrency(newTechnicians.filter(Boolean), CONCURRENCY, async (tech, i) => {
    const teamId = teamIds[(i + TECHNICIAN_OFFSET) % teamIds.length]
    const { error: roleErr } = await admin.from('profiles').update({ role: 'agent', department_id: orgManifest.departmentId }).eq('id', tech.id)
    if (roleErr) throw new Error(`promote ${tech.email}: ${roleErr.message}`)
    const { error: memberErr } = await admin.from('team_members').insert({ team_id: teamId, user_id: tech.id, org_id: orgManifest.orgId })
    if (memberErr) throw new Error(`team_members ${tech.email}: ${memberErr.message}`)
    tech.teamId = teamId
  })
  if (techSetupErrors.length) console.error(`[loadtest] ${techSetupErrors.length} technician setup errors (first 3):`, techSetupErrors.slice(0, 3))

  console.log('[loadtest] Promoting new managers to manager role...')
  const { errors: mgrSetupErrors } = await runWithConcurrency(newManagers.filter(Boolean), CONCURRENCY, async (mgr, i) => {
    const teamId = teamIds[(i + MANAGER_OFFSET) % teamIds.length]
    const { error: roleErr } = await admin.from('profiles').update({ role: 'manager', department_id: orgManifest.departmentId }).eq('id', mgr.id)
    if (roleErr) throw new Error(`promote ${mgr.email}: ${roleErr.message}`)
    const { error: memberErr } = await admin.from('team_members').insert({ team_id: teamId, user_id: mgr.id, org_id: orgManifest.orgId })
    if (memberErr) throw new Error(`team_members ${mgr.email}: ${memberErr.message}`)
    mgr.teamId = teamId
  })
  if (mgrSetupErrors.length) console.error(`[loadtest] ${mgrSetupErrors.length} manager setup errors (first 3):`, mgrSetupErrors.slice(0, 3))

  // Merge with whatever was already in the manifest - never lose personas
  // (and their access tokens) from a prior, smaller-scale stage.
  const requesters = [...existing.requesters, ...newRequesters.filter(Boolean)]
  const technicians = [...existing.technicians, ...newTechnicians.filter(Boolean)]
  const managers = [...existing.managers, ...newManagers.filter(Boolean)]

  const personasManifest = {
    runId: RUN_ID,
    requesters: requesters.filter(Boolean),
    technicians: technicians.filter(Boolean),
    managers: managers.filter(Boolean),
    counts: {
      requestersCreated: requesters.filter(Boolean).length,
      requesterErrors: reqErrors.length,
      techniciansCreated: technicians.filter(Boolean).length,
      technicianErrors: techErrors.length,
      managersCreated: managers.filter(Boolean).length,
      managerErrors: mgrErrors.length,
    },
  }
  const outPath = path.resolve(__dirname, '../results', RUN_ID, 'personas-manifest.json')
  writeFileSync(outPath, JSON.stringify(personasManifest, null, 2))
  console.log('[loadtest] Personas manifest written:', outPath)
  console.log('[loadtest] Counts:', personasManifest.counts)
}

main().catch((err) => { console.error('create-personas failed:', err); process.exit(1) })
