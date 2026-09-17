#!/usr/bin/env node
// Re-signs-in every persona in an existing manifest to get fresh access
// tokens (Supabase JWTs expire after ~1h) without recreating accounts.
//
// Usage: LOADTEST_ENV=main NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
//   node loadtest/setup/refresh-sessions.mjs <runId> <password>
import { createClient } from '@supabase/supabase-js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket

const RUN_ID = process.argv[2]
const PASSWORD = process.argv[3]
if (!RUN_ID || !PASSWORD) { console.error('usage: node refresh-sessions.mjs <runId> <password>'); process.exit(1) }

const manifestPath = path.resolve(__dirname, '../results', RUN_ID, 'personas-manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

async function runWithConcurrency(items, limit, task) {
  const results = new Array(items.length)
  const errors = []
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try { results[i] = await task(items[i], i) }
      catch (err) { errors.push({ index: i, error: err instanceof Error ? err.message : String(err) }) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return { results, errors }
}

async function refresh(persona) {
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await anon.auth.signInWithPassword({ email: persona.email, password: PASSWORD })
  if (error || !data.session) throw new Error(`refresh ${persona.email}: ${error?.message}`)
  return { ...persona, accessToken: data.session.access_token, refreshToken: data.session.refresh_token }
}

async function main() {
  console.log(`[refresh] refreshing sessions for run ${RUN_ID}: ${manifest.requesters.length} requesters, ${manifest.technicians.length} technicians, ${manifest.managers.length} managers`)

  const { results: requesters, errors: reqErrors } = await runWithConcurrency(manifest.requesters, 15, refresh)
  const { results: technicians, errors: techErrors } = await runWithConcurrency(manifest.technicians, 15, refresh)
  const { results: managers, errors: mgrErrors } = await runWithConcurrency(manifest.managers, 15, refresh)

  if (reqErrors.length) console.error(`[refresh] ${reqErrors.length} requester refresh errors (first 3):`, reqErrors.slice(0, 3))
  if (techErrors.length) console.error(`[refresh] ${techErrors.length} technician refresh errors (first 3):`, techErrors.slice(0, 3))
  if (mgrErrors.length) console.error(`[refresh] ${mgrErrors.length} manager refresh errors (first 3):`, mgrErrors.slice(0, 3))

  manifest.requesters = requesters.filter(Boolean)
  manifest.technicians = technicians.filter(Boolean)
  manifest.managers = managers.filter(Boolean)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`[refresh] done: ${manifest.requesters.length} requesters, ${manifest.technicians.length} technicians, ${manifest.managers.length} managers refreshed`)
}

main().catch((err) => { console.error('refresh-sessions failed:', err); process.exit(1) })
