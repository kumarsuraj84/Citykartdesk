import 'server-only'
/**
 * Records one round of health checks: the app's own checks (probes.ts) are stored as samples, then every check's recent samples decide whether an outage opens or closes
 * (evaluate.ts). The checks that only an outside observer can make (app, data service, gateway, NAS) are written AND judged by the one-minute probe on the app server
 * (scripts/health-probe.mjs, health_judge in the database), so a dead app still raises an incident. Once a day this prunes old rows. Nothing is sent anywhere: an outage is shown on the platform owners' Health page and as a bar on top
 * of their screens (portal only; e-mail can be added later if wanted).
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/observability/logger'
import { CHECKS, INCIDENT_AFTER } from './catalog'
import { decideIncident, type Sample } from './evaluate'
import { runInAppProbes, type Probe } from './probes'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => any }
const db = () => createAdminClient() as unknown as AnyClient

/** Which checks are switched on: all of them unless someone switched one off on the Settings tab. */
export async function enabledChecks(): Promise<(key: string) => boolean> {
  try {
    const { data } = await db().from('health_check_settings').select('check_key, enabled')
    const off = new Set(((data ?? []) as { check_key: string; enabled: boolean }[]).filter((r) => r.enabled === false).map((r) => r.check_key))
    return (key) => !off.has(key)
  } catch { return () => true }
}

export type CollectResult = { probes: Probe[]; opened: string[]; closed: string[]; pruned: number | null }

export async function collectOnce(): Promise<CollectResult> {
  const d = db()
  const enabled = await enabledChecks()
  const { probes, metrics } = await runInAppProbes(enabled)
  if (probes.length) {
    const { error } = await d.from('health_samples').insert(probes.map((p) => ({ check_key: p.key, ok: p.ok, ms: p.ms, detail: p.detail })))
    if (error) throw new Error(`could not store the health samples: ${error.message}`)
  }

  // numbers for the charts (the database server's load); a missing table (migration 201 not applied yet) never stops the checks
  if (metrics.length) {
    try { await d.from('health_metrics').insert(metrics) } catch { /* charts only */ }
  }

  // outages: judge the checks the APP measures itself, from their newest samples. (The checks the one-minute probe measures are judged by the probe itself,
  // through health_judge in the database, so an outage of the app is recorded even while the app is dead.)
  const keys = CHECKS.filter((c) => c.by === 'app').map((c) => c.key).filter((k) => enabled(k))
  const since = new Date(Date.now() - 15 * 60_000).toISOString()
  const { data: recent } = await d.from('health_samples').select('check_key, ok, at').in('check_key', keys).gte('at', since).order('at', { ascending: false }).limit(keys.length * 20)
  const by = new Map<string, Sample[]>()
  for (const r of (recent ?? []) as { check_key: string; ok: boolean; at: string }[]) by.set(r.check_key, [...(by.get(r.check_key) ?? []), { ok: r.ok, at: r.at }])
  const { data: openRows } = await d.from('health_incidents').select('id, check_key').is('ended_at', null)
  const open = new Map(((openRows ?? []) as { id: number; check_key: string }[]).map((r) => [r.check_key, r.id]))
  const opened: string[] = []
  const closed: string[] = []
  for (const key of keys) {
    const decision = decideIncident(by.get(key) ?? [], open.has(key))
    if (decision === 'open') {
      const latest = probes.find((p) => p.key === key)
      const { data: bad } = await d.from('health_samples').select('detail').eq('check_key', key).eq('ok', false).order('at', { ascending: false }).limit(1)
      const detail = latest && !latest.ok ? latest.detail : ((bad ?? []) as { detail: string | null }[])[0]?.detail ?? null
      const { error } = await d.from('health_incidents').insert({ check_key: key, detail, failed_samples: INCIDENT_AFTER })
      if (!error) opened.push(key)   // (the unique "one open incident per check" index makes a second insert harmless)
    } else if (decision === 'close') {
      await d.from('health_incidents').update({ ended_at: new Date().toISOString() }).eq('id', open.get(key))
      closed.push(key)
    } else if (open.has(key)) {
      // still failing: count it
      const { data: cur } = await d.from('health_incidents').select('failed_samples').eq('id', open.get(key)).maybeSingle()
      await d.from('health_incidents').update({ failed_samples: ((cur as { failed_samples?: number } | null)?.failed_samples ?? INCIDENT_AFTER) + 1 }).eq('id', open.get(key))
    }
  }
  // a check switched off must not leave an incident open for ever
  for (const [key, id] of open) if (!enabled(key)) await d.from('health_incidents').update({ ended_at: new Date().toISOString() }).eq('id', id)

  let pruned: number | null = null
  try {
    const day = new Date().toISOString().slice(0, 10)
    const { data: mark } = await d.from('app_settings').select('value').eq('key', 'health_last_prune').maybeSingle()
    if (((mark as { value?: string } | null)?.value ?? '') !== day) {
      const res = await d.rpc('health_prune')
      pruned = typeof res.data === 'number' ? res.data : null
      await d.from('app_settings').upsert({ key: 'health_last_prune', value: day }, { onConflict: 'key' })
    }
  } catch (e) { logger.warn({ event: 'health.prune_failed', message: 'The daily clean-up of the health tables failed', route: 'lib/health/collect.ts', error: e }) }

  return { probes, opened, closed, pruned }
}
