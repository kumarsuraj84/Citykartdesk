// System Log: turn what a caller supplies (SystemLogInput) into a table row. Pure; no I/O.

import { type SystemLogInput, boundedJson, clip, fingerprintOf, redactText, redactValue } from './shape'

export interface SystemLogRow {
  created_at: string
  org_id: string | null
  category: string
  source: string
  severity: string
  outcome: string
  action: string
  actor_id: string | null
  actor_role: string | null
  entity_type: string | null
  entity_id: string | null
  entity_label: string | null
  before_data: unknown
  after_data: unknown
  message: string | null
  error_code: string | null
  stack: string | null
  fingerprint: string | null
  request_id: string | null
  correlation_id: string | null
  session_id: string | null
  path: string | null
  method: string | null
  ip: string | null
  user_agent: string | null
  from_click: boolean | null
  click_target: string | null
  detail: unknown
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const uuidOrNull = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null)

/** Audit rows keep their before / after values as given (they are the evidence); errors and events are redacted. Both are size-bounded. */
export function toRow(i: SystemLogInput): SystemLogRow {
  const isError = i.category === 'error' || i.category === 'event'
  const message = i.message ? redactText(i.message).slice(0, 2000) : null
  const stack = i.stack ? redactText(i.stack).slice(0, 8000) : null
  return {
    created_at: new Date(i.at ?? Date.now()).toISOString(),
    org_id: uuidOrNull(i.orgId),
    category: i.category,
    source: i.source,
    severity: i.severity ?? (i.category === 'error' ? 'error' : 'info'),
    outcome: i.outcome ?? (i.category === 'error' ? 'failure' : 'success'),
    action: i.action.slice(0, 200),
    actor_id: uuidOrNull(i.actorId),
    actor_role: clip(i.actorRole, 40),
    entity_type: clip(i.entityType, 80),
    entity_id: clip(i.entityId, 120),
    entity_label: i.entityLabel ? clip(isError ? redactText(i.entityLabel) : i.entityLabel, 200) : null,
    before_data: boundedJson(i.before === undefined ? undefined : redactValue(i.before, 0, isError)),
    after_data: boundedJson(i.after === undefined ? undefined : redactValue(i.after, 0, isError)),
    message,
    error_code: clip(i.errorCode, 80),
    stack,
    fingerprint: isError ? fingerprintOf({ source: i.source, code: i.errorCode, message, where: i.path ?? i.action }) : null,
    request_id: clip(i.requestId, 80),
    correlation_id: clip(i.correlationId, 80),
    session_id: clip(i.sessionId, 80),
    path: i.path ? clip(i.path.split('?')[0], 300) : null,
    method: clip(i.method, 12),
    ip: clip(i.ip, 64),
    user_agent: clip(i.userAgent, 300),
    from_click: i.fromClick ?? null,
    click_target: i.clickTarget ? clip(redactText(i.clickTarget), 160) : null,
    detail: boundedJson(i.detail === undefined ? undefined : redactValue(i.detail)),
  }
}
