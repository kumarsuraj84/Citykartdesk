/**
 * DESK-OBS-001 — optional operator-alert adapter.
 *
 * Fires a webhook when something needs a human operator's attention (a cron
 * job failing outright, a business rule repeatedly failing to notify, an
 * email provider outage). No credentials are hardcoded — everything is
 * driven by `OPERATOR_ALERT_WEBHOOK_URL`, an env var this environment does
 * not set, so `alertOperator()` degrades to a safe no-op locally. A real
 * deployment can point this at Slack's incoming-webhook URL, PagerDuty's
 * Events API, or any endpoint that accepts a JSON POST — the payload shape
 * here is generic on purpose.
 */
import { logger } from './logger'

export type AlertSeverity = 'warning' | 'critical'

export interface OperatorAlert {
  /** Stable key this alert is deduplicated on — e.g. 'cron.alerts.total_failure'. */
  key: string
  severity: AlertSeverity
  title: string
  /** No secrets, no PII beyond what's already safe to log (ids, counts). */
  detail: Record<string, unknown>
  orgId?: string
}

const SECRET_KEY_PATTERN = /pass(word)?|secret|token|api[-_]?key|authoriz(a|e)tion|bearer|cookie|credential/i
const REDACTED = '[redacted]'

function redactDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(detail)) out[k] = SECRET_KEY_PATTERN.test(k) ? REDACTED : v
  return out
}

// Module-level dedup: (key -> last-fired timestamp). A restart clears it,
// which is fine — the point is suppressing bursts within one process
// lifetime (e.g. a cron that fires every minute hitting the same failure
// repeatedly), not a durable cross-deploy record.
const lastFired = new Map<string, number>()
const DEFAULT_DEDUP_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

export interface AlertOperatorOptions {
  /** Injectable for tests — defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /** Injectable clock for tests. */
  now?: () => number
  /** Override the dedup window (ms). */
  dedupWindowMs?: number
}

export type AlertOperatorResult =
  | { sent: true }
  | { sent: false; reason: 'not_configured' | 'deduped' | 'delivery_failed' }

/** Never throws — a failure to alert an operator must never crash the
 *  business action that triggered it. Callers should fire-and-forget or
 *  await-and-ignore, per how it's used in cron/business-rule call sites. */
export async function alertOperator(
  alert: OperatorAlert,
  opts: AlertOperatorOptions = {}
): Promise<AlertOperatorResult> {
  const webhookUrl = process.env.OPERATOR_ALERT_WEBHOOK_URL
  if (!webhookUrl) {
    // Absent config degrades safely — this is expected in every environment
    // that hasn't wired up a real operator channel yet, so it's a debug log,
    // not a warning.
    logger.debug({
      event: 'observability.alert.skipped',
      message: 'OPERATOR_ALERT_WEBHOOK_URL not configured — operator alert dropped',
      errorCode: alert.key,
      orgId: alert.orgId,
    })
    return { sent: false, reason: 'not_configured' }
  }

  const now = opts.now ?? Date.now
  const dedupWindowMs = opts.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS
  const nowMs = now()
  const last = lastFired.get(alert.key)
  if (last !== undefined && nowMs - last < dedupWindowMs) {
    return { sent: false, reason: 'deduped' }
  }

  const doFetch = opts.fetchImpl ?? fetch
  try {
    const res = await doFetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: alert.key,
        severity: alert.severity,
        title: alert.title,
        detail: redactDetail(alert.detail),
        orgId: alert.orgId,
        ts: new Date(nowMs).toISOString(),
      }),
    })
    if (!res.ok) {
      logger.warn({
        event: 'observability.alert.delivery_failed',
        message: `Operator alert webhook responded ${res.status}`,
        errorCode: alert.key,
        orgId: alert.orgId,
      })
      return { sent: false, reason: 'delivery_failed' }
    }
    lastFired.set(alert.key, nowMs)
    return { sent: true }
  } catch (err) {
    logger.warn({
      event: 'observability.alert.delivery_failed',
      message: 'Operator alert webhook threw',
      errorCode: alert.key,
      orgId: alert.orgId,
      error: err,
    })
    return { sent: false, reason: 'delivery_failed' }
  }
}

/** Test-only: clears the in-memory dedup map between test cases. */
export function __resetAlertDedupForTests(): void {
  lastFired.clear()
}
