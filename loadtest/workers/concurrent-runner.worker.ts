// Lightweight, single-process load driver — replaces run.mjs's per-shard
// OS-process fork model (loadtest/run.mjs), which was proven on 2026-09-16
// to consume 4.4x more CPU than Main's actual services under target load
// (312.89 vs 71.68 CPU-seconds), making capacity conclusions drawn from it
// unreliable. This file achieves the same goal - many concurrent personas,
// each with their own real identity, calling the real Server Action
// functions - inside ONE Node process, so the load generator's own CPU
// footprint stays small relative to what it's measuring.
//
// The reason the original harness needed one OS process per shard: the
// mocked createClient() returns a single static value
// (mockResolvedValue), so two concurrent personas in the same process
// would race and see each other's identity. AsyncLocalStorage solves this
// correctly - Node's own mechanism for per-async-call-chain context,
// the same primitive Next.js itself uses for request-scoped state - by
// making createClient()/headers() read the CURRENT concurrent task's
// context instead of a shared static value, so many personas can run
// truly concurrently (interleaved on one event loop, not one at a time)
// without cross-contamination.
import { AsyncLocalStorage } from 'node:async_hooks'
import { describe, it, vi } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

type PersonaContext = { accessToken: string; userId: string }
const als = new AsyncLocalStorage<PersonaContext>()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    const ctx = als.getStore()
    if (!ctx) throw new Error('createClient() called outside an als.run() persona context')
    return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${ctx.accessToken}` } },
    })
  }),
}))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (name: string) => {
      const ctx = als.getStore()
      return name === 'x-verified-user-id' ? (ctx?.userId ?? null) : null
    },
  })),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createRequestCore } from '@/lib/requests/create-request-core'
import { updateRequestStatus, assignRequest, addComment } from '@/lib/actions/requests'

type Persona = { id: string; email: string; fullName: string; accessToken: string; teamId?: string }
type PersonasManifest = { runId: string; requesters: Persona[]; technicians: Persona[]; managers: Persona[] }
type OrgManifest = { runId: string; orgId: string; services: { serviceId: string; subCategoryIds: string[] }[]; teamIds: string[] }

const RUN_ID = process.env.LOADTEST_RUN_ID!
const CONCURRENCY = Number(process.env.LOADTEST_CONCURRENCY ?? 15)
const TICKETS_PER_REQUESTER = Number(process.env.LOADTEST_TICKETS_PER_REQUESTER ?? 1)
const ACTIONS_PER_TECHNICIAN = Number(process.env.LOADTEST_ACTIONS_PER_TECHNICIAN ?? 5)
const JITTER_MS = Number(process.env.LOADTEST_JITTER_MS ?? 150)

const resultsDir = path.resolve(__dirname, '../results', RUN_ID)
mkdirSync(resultsDir, { recursive: true })
const personas: PersonasManifest = JSON.parse(readFileSync(path.join(resultsDir, 'personas-manifest.json'), 'utf8'))
const org: OrgManifest = JSON.parse(readFileSync(path.join(resultsDir, 'org-manifest.json'), 'utf8'))
const metricsPath = path.join(resultsDir, 'metrics.ndjson')

function record(scenario: string, ms: number, ok: boolean, error?: string) {
  appendFileSync(metricsPath, JSON.stringify({ scenario, ms, ok, error, at: new Date().toISOString() }) + '\n')
}
async function timed<T extends { error?: string } | unknown>(scenario: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    const result = await fn()
    const appError = (result as { error?: string } | null)?.error
    if (appError) record(scenario, performance.now() - start, false, `[app-rejected] ${appError}`)
    else record(scenario, performance.now() - start, true)
    return result
  } catch (err) {
    record(scenario, performance.now() - start, false, `[thrown] ${err instanceof Error ? err.message : String(err)}`)
    throw err
  }
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }
function jitter() { return sleep(Math.random() * JITTER_MS) }

const DESCRIPTIONS = [
  'Printer not working at the front desk, please assist urgently.',
  'Need access to the shared drive for the new project.',
  'Laptop screen flickering intermittently since this morning.',
  'Requesting a new monitor for the workstation.',
  'VPN connection keeps dropping during work hours.',
]

async function runRequester(requester: Persona) {
  await als.run({ accessToken: requester.accessToken, userId: requester.id }, async () => {
    for (let n = 0; n < TICKETS_PER_REQUESTER; n++) {
      await jitter()
      const chosenService = org.services[Math.floor(Math.random() * org.services.length)]
      try {
        await timed('create_request', () =>
          createRequestCore({
            client: createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
              auth: { autoRefreshToken: false, persistSession: false },
              global: { headers: { Authorization: `Bearer ${requester.accessToken}` } },
            }) as never,
            orgId: org.orgId,
            requesterId: requester.id,
            actingUserId: requester.id,
            serviceId: chosenService.serviceId,
            subCategoryId: chosenService.subCategoryIds[Math.floor(Math.random() * chosenService.subCategoryIds.length)],
            formData: { description_field: DESCRIPTIONS[Math.floor(Math.random() * DESCRIPTIONS.length)] },
            source: 'web',
          })
        )
      } catch (err) { void err }
    }
    // Requester replies to anything of theirs a technician moved to waiting_user.
    await jitter()
    const reqClient = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${requester.accessToken}` } },
    })
    const { data: waiting } = await reqClient.from('requests').select('id').eq('requester_id', requester.id).eq('status', 'waiting_user').limit(3)
    for (const ticket of (waiting ?? []) as { id: string }[]) {
      try { await timed('requester_reply', () => addComment(ticket.id, 'Thanks, still facing this issue - please continue.', false)) } catch (err) { void err }
    }
  })
}

async function runTechnician(tech: Persona) {
  if (!tech.teamId) return
  await als.run({ accessToken: tech.accessToken, userId: tech.id }, async () => {
    const techClient = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${tech.accessToken}` } },
    })
    let handled = 0, attempts = 0
    while (handled < ACTIONS_PER_TECHNICIAN && attempts < ACTIONS_PER_TECHNICIAN * 4) {
      attempts++
      await jitter()
      const { data: myTickets } = await techClient.from('requests').select('id, status').eq('assigned_to', tech.id).in('status', ['in_progress', 'waiting_user']).limit(10)
      let acted = false
      if (myTickets && myTickets.length > 0) {
        const ticket = myTickets[Math.floor(Math.random() * myTickets.length)] as { id: string; status: string }
        try {
          if (ticket.status === 'waiting_user') {
            await timed('resume', () => updateRequestStatus(ticket.id, 'in_progress'))
          } else {
            const roll = Math.random()
            if (roll < 0.45) await timed('comment', () => addComment(ticket.id, 'Working on this issue, will update shortly.', false))
            else if (roll < 0.65) await timed('waiting_user', () => updateRequestStatus(ticket.id, 'waiting_user', 'Please provide more details so I can proceed.'))
            else await timed('resolve', () => updateRequestStatus(ticket.id, 'resolved', 'Issue resolved.'))
          }
          acted = true
        } catch (err) { void err; acted = true }
      }
      if (!acted) {
        const { data: freshTickets } = await techClient.from('requests').select('id, status').eq('team_id', tech.teamId).in('status', ['open', 'assigned']).limit(10)
        if (!freshTickets || freshTickets.length === 0) { attempts = ACTIONS_PER_TECHNICIAN * 4; break }
        const ticket = freshTickets[Math.floor(Math.random() * freshTickets.length)] as { id: string; status: string }
        try {
          if (ticket.status === 'open') {
            await timed('pickup', () => assignRequest(ticket.id, tech.id))
            await timed('start_working', () => updateRequestStatus(ticket.id, 'in_progress', 'Looking into this now.'))
          } else {
            await timed('start_working', () => updateRequestStatus(ticket.id, 'in_progress', 'Looking into this now.'))
          }
        } catch (err) { void err }
      }
      handled++
    }
  })
}

// Bounded-concurrency pool: at most CONCURRENCY personas in flight at
// once, staggered by jitter() inside each task - "compressed day", not
// "every ticket at the same millisecond".
async function runPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0
  async function worker() {
    while (next < items.length) {
      const item = items[next++]
      await task(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

describe(`lightweight concurrent load driver (run ${RUN_ID})`, () => {
  it('runs requesters and technicians with bounded real concurrency, single process', async () => {
    await Promise.all([
      runPool(personas.requesters, CONCURRENCY, runRequester),
      runPool(personas.technicians, Math.max(5, Math.floor(CONCURRENCY / 2)), runTechnician),
    ])
  }, 20 * 60_000)
})
