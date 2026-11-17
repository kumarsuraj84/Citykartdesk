import 'server-only'
/**
 * "Move everything that matches these filters" (stage 3). Two parts:
 *  - prepareRun(): reads EVERY matching Zoho ticket (page by page), works out the plan of each one exactly as the preview does, and reports how many are ready, how many are open
 *    or finished, why the others cannot move yet, and the list of ready numbers (so the screen can move them in chunks, with Pause / Stop between chunks);
 *  - the chunk mover is moveZohoTickets() from move.ts, which re-reads and re-checks every ticket itself. Nothing here is trusted by the mover.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import {
  loadCkCatalogue, loadMovedNumbers, loadPeopleDirectory, loadSavedMapping, loadTicketsForPreview, matchPerson, savedPeopleMap, toMappings, type MoveFilters,
} from './data'
import { planTicket, PROBLEM_TITLES, type PlanProblemCode } from './plan'
import { isFinishedCkStatus } from './suggest'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }
const db = () => createAdminClient() as unknown as AnyClient

/** A run reads at most this many tickets in one go; a bigger selection is narrowed by the filters (dates, status ...) and run again. */
export const RUN_SCAN_LIMIT = 20_000
const PAGE = 500

export type RunPrepared = {
  scanned: number
  matching: number
  ready: number
  readyOpen: number
  readyFinished: number
  blocked: number
  alreadyMoved: number
  reasons: { code: PlanProblemCode; title: string; count: number }[]
  /** the ready Zoho numbers, newest first */
  numbers: number[]
  newestReady: string | null
  oldestReady: string | null
  /** true when the filters match more than RUN_SCAN_LIMIT tickets: only the newest RUN_SCAN_LIMIT were looked at */
  truncated: boolean
}

export async function prepareRun(orgId: string, filters: MoveFilters): Promise<RunPrepared> {
  const [cat, saved, dir] = await Promise.all([loadCkCatalogue(orgId), loadSavedMapping(orgId), loadPeopleDirectory(orgId)])
  const maps = toMappings(saved)
  const services = new Map(cat.services.map((s) => [s.id, s]))
  const templates = new Map(cat.templates.map((t) => [t.id, { id: t.id, name: t.name }]))
  const reqHand = savedPeopleMap(saved, 'requester', dir)
  const techHand = savedPeopleMap(saved, 'technician', dir)
  const moved = await loadMovedNumbers(orgId)
  const movedList = [...moved]

  const out: RunPrepared = { scanned: 0, matching: 0, ready: 0, readyOpen: 0, readyFinished: 0, blocked: 0, alreadyMoved: 0, reasons: [], numbers: [], newestReady: null, oldestReady: null, truncated: false }
  const reasons = new Map<PlanProblemCode, number>()
  let beforeNo: number | undefined
  for (;;) {
    const { total, rows } = await loadTicketsForPreview(filters, movedList, { limit: PAGE, beforeNo })
    if (beforeNo === undefined) out.matching = total
    if (rows.length === 0) break
    for (const t of rows) {
      out.scanned++
      const plan = planTicket({
        ticket: t, maps, services, templates,
        requester: matchPerson(dir, reqHand, { email: t.requesterEmail, name: t.requesterName }),
        technician: matchPerson(dir, techHand, { email: t.technicianEmail ?? null, name: t.technicianName }),
        alreadyMoved: moved.has(t.displayId),
      })
      if (plan.ready) {
        out.ready++
        out.numbers.push(t.displayId)
        if (isFinishedCkStatus(plan.status)) out.readyFinished++; else out.readyOpen++
        if (plan.createdAt) {
          if (!out.newestReady || plan.createdAt > out.newestReady) out.newestReady = plan.createdAt
          if (!out.oldestReady || plan.createdAt < out.oldestReady) out.oldestReady = plan.createdAt
        }
      } else {
        out.blocked++
        for (const p of plan.problems) {
          reasons.set(p.code, (reasons.get(p.code) ?? 0) + 1)
          if (p.code === 'already_moved') out.alreadyMoved++
        }
      }
    }
    beforeNo = rows[rows.length - 1].displayId
    if (out.scanned >= RUN_SCAN_LIMIT) { out.truncated = out.matching > out.scanned; break }
    if (rows.length < PAGE) break
  }
  out.reasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, title: PROBLEM_TITLES[code], count }))
  return out
}

// ── the run log ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type RunFailure = { no: number; reason: string }
const MAX_FAILURES = 200

export async function startRun(orgId: string, actorId: string, filters: MoveFilters, asked: number): Promise<string | null> {
  const { data, error } = await db().from('zoho_transfer_runs').insert({ org_id: orgId, started_by: actorId, filters, asked }).select('id').single()
  return error || !data ? null : (data.id as string)
}

/** Adds one chunk's outcome to the run. Returns false when the run is not this organisation's, or is no longer running. */
export async function addToRun(orgId: string, runId: string, moved: number, failures: RunFailure[]): Promise<boolean> {
  const d = db()
  const { data: run } = await d.from('zoho_transfer_runs').select('id, state, moved, failed, failures').eq('id', runId).eq('org_id', orgId).maybeSingle()
  if (!run || run.state !== 'running') return false
  const all = ([...(run.failures as RunFailure[]), ...failures]).slice(0, MAX_FAILURES)
  const { error } = await d.from('zoho_transfer_runs').update({ moved: Number(run.moved) + moved, failed: Number(run.failed) + failures.length, failures: all }).eq('id', runId)
  return !error
}

export async function finishRun(orgId: string, runId: string, stopped: boolean): Promise<void> {
  await db().from('zoho_transfer_runs').update({ state: stopped ? 'stopped' : 'finished', finished_at: new Date().toISOString() }).eq('id', runId).eq('org_id', orgId).eq('state', 'running')
}

export async function loadRecentRuns(orgId: string, limit = 8) {
  const { data } = await db().from('zoho_transfer_runs').select('id, started_at, finished_at, state, asked, moved, failed, started_by').eq('org_id', orgId).order('started_at', { ascending: false }).limit(limit)
  return (data ?? []) as { id: string; started_at: string; finished_at: string | null; state: string; asked: number; moved: number; failed: number; started_by: string | null }[]
}
