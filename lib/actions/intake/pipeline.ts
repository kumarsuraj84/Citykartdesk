'use server'

import { getCurrentProfile } from '@/lib/queries/profiles'
import { createClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any }

export type ReclassifyProgress = {
  totalMessages: number
  classified: number
  byStage: { rule: number; local_model: number; premium_ai: number; unknown: number }
  byConfidence: { low: number; medium: number; good: number; high: number }
  avgConfidence: number
  // Stage 2 escalation funnel: how many messages were actually SENT to the model
  // (a row was written) vs how many it WON (became is_final). A high attempts /
  // low wins gap means escalation is firing but the rules already agreed.
  stage2Attempts: number
}

export type TestStage2Result = {
  ok: boolean
  error?: string
  provider?: string
  model?: string
  latencyMs?: number
  sample?: { subject: string; text: string }
  result?: {
    suggestedType: string
    suggestedDepartment: string | null
    suggestedCategory: string | null
    suggestedPriority: string
    confidence: number
    rationale: string
    costMicrocents?: number
  }
}

// Fires one sample email at the worker's Stage 2 model and returns the raw
// result without persisting. Admin only. Quick confidence check that the LLM
// key/endpoint/model are correctly configured.
export async function testStage2(): Promise<TestStage2Result> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) {
    return { ok: false, error: 'Unauthorized.' }
  }

  const rawUrl = process.env.INTAKE_WORKER_URL
  const secret = process.env.INTAKE_WORKER_SECRET ?? process.env.CRON_SECRET
  if (!rawUrl || !secret) return { ok: false, error: 'Worker not configured.' }
  const workerUrl = (/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`).replace(/\/$/, '')

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    let res: Response
    try {
      res = await fetch(`${workerUrl}/intake/test-classify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-intake-worker-secret': secret },
        body: JSON.stringify({}),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
    return (await res.json()) as TestStage2Result
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not reach worker.'
    return { ok: false, error: msg.includes('abort') || msg.includes('timed out') ? 'Worker timed out (>30s).' : msg }
  }
}

// Live progress snapshot for the re-classify run. The worker writes
// intake_classifications / intake_reviews rows as it processes, so polling these
// counts shows real-time movement without any cross-service plumbing.
export async function getReclassifyProgress(): Promise<ReclassifyProgress> {
  const empty: ReclassifyProgress = {
    totalMessages: 0,
    classified: 0,
    byStage: { rule: 0, local_model: 0, premium_ai: 0, unknown: 0 },
    byConfidence: { low: 0, medium: 0, good: 0, high: 0 },
    avgConfidence: 0,
    stage2Attempts: 0,
  }

  // RLS on intake_messages/intake_classifications already org-scopes every row
  // (see migrations 053/055), so this check is defense-in-depth for consistency
  // with this file's other two functions, not the only thing standing between
  // an anonymous caller and cross-org data.
  const profile = await getCurrentProfile()
  if (!profile || !['agent', 'manager', 'admin', 'platform_owner'].includes(profile.role)) {
    return empty
  }

  const supabase = (await createClient()) as unknown as AnyClient

  // Total ingested messages (the denominator).
  const { count: totalMessages } = await supabase
    .from('intake_messages')
    .select('id', { count: 'exact', head: true })

  // Stage 2 ATTEMPTS — every local_model row, whether or not it won (is_final).
  // This is the true signal that escalation is firing; the byStage.local_model
  // count below only reflects the ones the model actually won.
  const { count: stage2Attempts } = await supabase
    .from('intake_classifications')
    .select('id', { count: 'exact', head: true })
    .eq('stage', 'local_model')

  // Every final classification produced so far, with its stage + confidence.
  const { data: rows } = await supabase
    .from('intake_classifications')
    .select('stage, confidence')
    .eq('is_final', true)

  const all = (rows ?? []) as { stage: string | null; confidence: number | null }[]
  const byStage = { ...empty.byStage }
  const byConfidence = { ...empty.byConfidence }
  let confidenceSum = 0

  for (const r of all) {
    const stage = (r.stage ?? 'unknown') as keyof typeof byStage
    if (stage in byStage) byStage[stage]++
    else byStage.unknown++

    const c = r.confidence ?? 0
    confidenceSum += c
    if (c < 40)      byConfidence.low++
    else if (c < 70) byConfidence.medium++
    else if (c < 90) byConfidence.good++
    else             byConfidence.high++
  }

  return {
    totalMessages: totalMessages ?? 0,
    classified: all.length,
    byStage,
    byConfidence,
    avgConfidence: all.length > 0 ? Math.round(confidenceSum / all.length) : 0,
    stage2Attempts: stage2Attempts ?? 0,
  }
}

// Triggers the worker's backlog re-classification. Admin only. Used for the
// one-time backfill of already-ingested mail and after rule/config changes.
// force=true re-runs the pipeline on already-classified-but-un-actioned (pending)
// messages so changes like enabling Stage 2 take effect on existing mail.
// sinceDate (ISO string) — only process messages received on or after this date.
// Older messages are left unclassified but remain fully readable.
export async function reclassifyBacklog(
  force = false,
  sinceDate?: string,
): Promise<{ ok: boolean; processed?: number; error?: string }> {
  const profile = await getCurrentProfile()
  if (!profile || !['admin', 'platform_owner'].includes(profile.role)) {
    return { ok: false, error: 'Unauthorized.' }
  }

  const rawUrl = process.env.INTAKE_WORKER_URL
  const workerSecret = process.env.INTAKE_WORKER_SECRET ?? process.env.CRON_SECRET
  if (!rawUrl || !workerSecret) {
    return { ok: false, error: 'Worker not configured (INTAKE_WORKER_URL / INTAKE_WORKER_SECRET).' }
  }
  // Tolerate a bare host (prepend https://) and strip trailing slash.
  const workerUrl = (/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`).replace(/\/$/, '')

  const body: Record<string, unknown> = { limit: 2000, force }
  if (sinceDate) body.since = sinceDate

  try {
    const res = await fetch(`${workerUrl}/intake/reclassify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-intake-worker-secret': workerSecret },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { ok: boolean; message?: string; processed?: number; error?: string }
    return data
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not reach worker.' }
  }
}
