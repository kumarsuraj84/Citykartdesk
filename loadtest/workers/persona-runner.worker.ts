// Genuine server-action-level load worker. One `vitest run` process = one
// shard. Runs personas in its shard SEQUENTIALLY (one persona's action fully
// awaited before the next) - this is what makes it safe to mock
// @/lib/supabase/server exactly like the rest of this repo's integration
// suite does; concurrency across the FULL persona population comes from
// loadtest/run.mjs spawning many shards (separate OS processes, real
// parallelism) at once, the same way a real load-testing tool's virtual
// users work internally.
import { describe, it, expect, vi } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import path from 'node:path'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: () => null }),
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import { createRequestCore } from '@/lib/requests/create-request-core'
import { updateRequestStatus, assignRequest, addComment } from '@/lib/actions/requests'
import { MetricsRecorder } from '../lib/metrics'

const mockedCreateClient = vi.mocked(createClient)
const mockedHeaders = vi.mocked(headers)

function clientForToken(accessToken: string) {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

type Persona = { id: string; email: string; fullName: string; accessToken: string; teamId?: string }
type PersonasManifest = { runId: string; requesters: Persona[]; technicians: Persona[]; managers: Persona[] }
type OrgManifest = {
  runId: string
  orgId: string
  services: { serviceId: string; subCategoryIds: string[] }[]
  teamIds: string[]
}

const RUN_ID = process.env.LOADTEST_RUN_ID!
const WORKER_INDEX = Number(process.env.LOADTEST_WORKER_INDEX ?? 0)
const TOTAL_WORKERS = Number(process.env.LOADTEST_TOTAL_WORKERS ?? 1)
const TICKETS_PER_REQUESTER = Number(process.env.LOADTEST_TICKETS_PER_REQUESTER ?? 1)
const ACTIONS_PER_TECHNICIAN = Number(process.env.LOADTEST_ACTIONS_PER_TECHNICIAN ?? 5)

const resultsDir = path.resolve(__dirname, '../results', RUN_ID)
const personas: PersonasManifest = JSON.parse(readFileSync(path.join(resultsDir, 'personas-manifest.json'), 'utf8'))
const org: OrgManifest = JSON.parse(readFileSync(path.join(resultsDir, 'org-manifest.json'), 'utf8'))
const metrics = new MetricsRecorder(RUN_ID, `worker-${WORKER_INDEX}`)

function myShare<T>(items: T[]): T[] {
  return items.filter((_, i) => i % TOTAL_WORKERS === WORKER_INDEX)
}

// Mirrors proxy.ts's own behavior exactly: real requests carry an
// x-verified-user-id header the edge middleware already set after verifying
// the session once, so getCurrentProfile() (lib/queries/profiles.ts) skips
// its own redundant auth.getUser() round-trip. Without this, every single
// action here would take that fallback path - a real network call to
// GoTrue's /user endpoint on every call from every concurrent worker - which
// is not what real production traffic does, and inflates every measured
// latency here with a network hop production requests never pay.
function asPersona(p: Persona) {
  mockedCreateClient.mockResolvedValue(clientForToken(p.accessToken) as never)
  mockedHeaders.mockResolvedValue({ get: (name: string) => (name === 'x-verified-user-id' ? p.id : null) } as never)
}

const DESCRIPTIONS = [
  'Printer not working at the front desk, please assist urgently.',
  'Need access to the shared drive for the new project.',
  'Laptop screen flickering intermittently since this morning.',
  'Requesting a new monitor for the workstation.',
  'VPN connection keeps dropping during work hours.',
]

describe(`loadtest worker ${WORKER_INDEX}/${TOTAL_WORKERS} (run ${RUN_ID})`, () => {
  it('runs its shard of requesters and technicians', async () => {
    const admin = clientForToken(process.env.SUPABASE_SERVICE_ROLE_KEY!) // service-role-equivalent read-only lookups only via RLS-bypassing key is NOT used for writes below

    const myRequesters = myShare(personas.requesters)
    const myTechnicians = myShare(personas.technicians)

    // ── Requesters: create tickets ──
    for (const requester of myRequesters) {
      for (let n = 0; n < TICKETS_PER_REQUESTER; n++) {
        asPersona(requester)
        const chosenService = org.services[Math.floor(Math.random() * org.services.length)]
        const serviceId = chosenService.serviceId
        const subCategoryId = chosenService.subCategoryIds[Math.floor(Math.random() * chosenService.subCategoryIds.length)]
        const description = DESCRIPTIONS[Math.floor(Math.random() * DESCRIPTIONS.length)]
        try {
          await metrics.timed('create_request', () =>
            createRequestCore({
              client: clientForToken(requester.accessToken) as never,
              orgId: org.orgId,
              requesterId: requester.id,
              actingUserId: requester.id,
              serviceId,
              subCategoryId,
              formData: { description_field: description },
              source: 'web',
            })
          )
        } catch (err) {
          metrics.record('create_request', 0, false, err instanceof Error ? err.message : String(err))
        }
      }
    }

    // ── Technicians: work MY OWN queue first (advance in_progress/waiting_user
    // tickets already assigned to me toward resolution), only picking up a
    // fresh open/assigned team ticket when I have nothing of my own to
    // advance. This is what makes the lifecycle mix realistic - a technician
    // finishing what they started, not perpetually grabbing new work. ──
    for (const tech of myTechnicians) {
      if (!tech.teamId) continue
      let handled = 0
      let attempts = 0
      const techClient = clientForToken(tech.accessToken)
      while (handled < ACTIONS_PER_TECHNICIAN && attempts < ACTIONS_PER_TECHNICIAN * 4) {
        attempts++
        asPersona(tech)

        const { data: myTickets } = await techClient
          .from('requests')
          .select('id, status')
          .eq('assigned_to', tech.id)
          .in('status', ['in_progress', 'waiting_user'])
          .limit(10)

        let acted = false
        if (myTickets && myTickets.length > 0) {
          const ticket = myTickets[Math.floor(Math.random() * myTickets.length)]
          try {
            if (ticket.status === 'waiting_user') {
              // Simulates the requester having replied - resume, then keep working it.
              await metrics.timed('resume', () => updateRequestStatus(ticket.id, 'in_progress'))
            } else {
              const roll = Math.random()
              if (roll < 0.45) {
                await metrics.timed('comment', () => addComment(ticket.id, 'Working on this issue, will update shortly.', false))
              } else if (roll < 0.65) {
                await metrics.timed('waiting_user', () => updateRequestStatus(ticket.id, 'waiting_user', 'Please provide more details so I can proceed.'))
              } else {
                await metrics.timed('resolve', () => updateRequestStatus(ticket.id, 'resolved', 'Issue resolved.'))
              }
            }
            acted = true
          } catch (err) {
            metrics.record('technician_action', 0, false, `[thrown] ${err instanceof Error ? err.message : String(err)}`)
            acted = true
          }
        }

        if (!acted) {
          const { data: freshTickets } = await techClient
            .from('requests')
            .select('id, status')
            .eq('team_id', tech.teamId)
            .in('status', ['open', 'assigned'])
            .limit(10)
          if (!freshTickets || freshTickets.length === 0) { attempts = ACTIONS_PER_TECHNICIAN * 4; break }
          const ticket = freshTickets[Math.floor(Math.random() * freshTickets.length)]
          try {
            if (ticket.status === 'open') {
              await metrics.timed('pickup', () => assignRequest(ticket.id, tech.id))
              await metrics.timed('start_working', () => updateRequestStatus(ticket.id, 'in_progress', 'Looking into this now.'))
            } else {
              await metrics.timed('start_working', () => updateRequestStatus(ticket.id, 'in_progress', 'Looking into this now.'))
            }
          } catch (err) {
            metrics.record('technician_action', 0, false, `[thrown] ${err instanceof Error ? err.message : String(err)}`)
          }
        }
        handled++
      }
    }

    // ── Requester responses: check my own tickets for anything a
    // technician moved to waiting_user while this worker was busy, and
    // reply (moves it back to in_progress, per updateRequestStatus's own
    // waiting-user-reply handling). Deliberately the last pass in this
    // worker so technicians (across all concurrently-running workers)
    // have had a chance to set some tickets to waiting_user first. ──
    for (const requester of myRequesters) {
      asPersona(requester)
      const reqClient = clientForToken(requester.accessToken)
      const { data: waiting } = await reqClient
        .from('requests')
        .select('id')
        .eq('requester_id', requester.id)
        .eq('status', 'waiting_user')
        .limit(3)
      for (const ticket of waiting ?? []) {
        try {
          await metrics.timed('requester_reply', () => addComment(ticket.id, 'Thanks, still facing this issue - please continue.', false))
        } catch (err) {
          metrics.record('requester_reply', 0, false, `[thrown] ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    void admin
    expect(myRequesters.length + myTechnicians.length).toBeGreaterThanOrEqual(0)
  }, 600_000)
})
