import { supabase } from '../../lib/supabase.js'
import { log } from '../../lib/log.js'
import type { Classifier, IntakeEnvelope } from './types.js'
import { RuleClassifier } from './rule-classifier.js'
import { DEFAULT_RULES, type ClassificationRule } from './ruleset.js'
import { LocalModelClassifier, localModelConfigured } from './local-model-classifier.js'
import { loadCatalog, resolveService, type CatalogService } from './catalog.js'

// Provider registry. Each stage implements the same Classifier contract — adding
// one never touches the orchestrator loop, the schema, or the API.
const REGISTRY: Record<string, Classifier> = {
  rule_engine: new RuleClassifier(),
  // Stage 2 — registered only when an LLM API key is configured.
  ...(localModelConfigured() ? { local_model: new LocalModelClassifier() } : {}),
  // 'claude': new PremiumAiClassifier('claude'),        // Stage 3 (future)
}

interface StageConfig {
  stage: string
  provider: string
  model_version?: string  // written by the worker so the settings page can read it
  enabled: boolean
  min_confidence: number
}

// Confidence at/above which a no-work classification (informational / ignore)
// is auto-resolved instead of parked in the human review queue. Keeps the
// "Needs review" folder to genuinely actionable mail. Below this, FYI still
// gets a human glance.
const AUTO_RESOLVE_CONFIDENCE = 80
const NO_WORK_TYPES = new Set(['informational', 'ignore'])
// Types that become a work item and therefore want a resolved service (F2).
const ACTIONABLE_TYPES = new Set(['request', 'task', 'approval'])

interface PipelineConfig {
  stages: StageConfig[]
  escalate_below_confidence: number
  auto_accept_at_confidence: number
}

// Default pipeline (rules-first coverage + background model escalation). The rule
// engine runs FIRST and is the coverage floor: every message gets an instant,
// deterministic classification, so nothing sits unclassified ("No review detail").
// When an LLM key is configured the local model is registered as Stage 2, but it
// does NOT run inline on the bulk backlog — running a rate-limited LLM on every one
// of thousands of messages made classification fall behind and left most mail
// unclassified. Instead the model UPGRADES uncertain, actionable mail in the
// background (escalateCatchUp), which is resumable and rate-limit-safe. Live
// single-message ingestion still escalates inline (one call, no backlog pressure).
const DEFAULT_CONFIG: PipelineConfig = {
  stages: [
    { stage: 'rule', provider: 'rule_engine', enabled: true, min_confidence: 0 },
    ...(localModelConfigured()
      ? [{ stage: 'local_model', provider: 'local_model', enabled: true, min_confidence: 0 }]
      : []),
  ],
  escalate_below_confidence: 85,
  auto_accept_at_confidence: 90,
}

async function loadConfig(orgId: string): Promise<PipelineConfig> {
  const { data } = await supabase
    .from('intake_pipeline_config')
    .select('config')
    .eq('org_id', orgId)
    .maybeSingle()
  const config = (data?.config as PipelineConfig) ?? DEFAULT_CONFIG
  return ensureLocalModelStage(config)
}

// Org-authored Stage-1 rules (intake_rules). Mapped to ClassificationRule and
// flagged isCustom so the engine evaluates them first and locks their dimension.
async function loadCustomRules(orgId: string): Promise<ClassificationRule[]> {
  const { data } = await supabase
    .from('intake_rules')
    .select('id, name, match_field, match_keywords, match_regex, output_type, output_department, output_category, output_subcategory, output_priority, weight')
    .eq('org_id', orgId)
    .eq('enabled', true)
  if (!data?.length) return []
  return data.map((r): ClassificationRule => ({
    key: `custom:${r.name}`,
    dimension: 'type',                    // descriptive only; output drives behaviour
    match: {
      field: r.match_field as ClassificationRule['match']['field'],
      anyKeywords: (r.match_keywords as string[] | null) ?? undefined,
      regex: r.match_regex ?? undefined,
    },
    output: {
      type: (r.output_type as ClassificationRule['output']['type']) ?? undefined,
      department: r.output_department ?? undefined,
      category: r.output_category ?? undefined,
      subcategory: r.output_subcategory ?? undefined,
      priority: (r.output_priority as ClassificationRule['output']['priority']) ?? undefined,
    },
    weight: r.weight,
    isCustom: true,
  }))
}

// Build the Stage-1 engine for an org: custom rules (first, precedence) merged
// over the code defaults. Falls back to the shared registry instance when the
// org has no custom rules.
function ruleEngineFor(customRules: ClassificationRule[]): Classifier {
  return customRules.length
    ? new RuleClassifier([...customRules, ...DEFAULT_RULES])
    : REGISTRY['rule_engine']
}

// The Phase-C seed row left the local_model stage disabled and pointed at a
// placeholder provider ('qwen2.5'). Whenever an LLM key is actually configured,
// force an ENABLED local_model stage wired to the registered classifier — so
// Stage 2 escalation works without anyone hand-editing the config table.
function ensureLocalModelStage(config: PipelineConfig): PipelineConfig {
  if (!localModelConfigured()) return config
  const stages = [...(config.stages ?? [])]
  const idx = stages.findIndex((s) => s.stage === 'local_model')
  const lmc = REGISTRY['local_model'] as { provider: string; modelVersion: string } | undefined
  const fixed: StageConfig = {
    stage: 'local_model',
    provider: lmc?.provider ?? process.env.INTAKE_LLM_PROVIDER ?? 'groq',
    model_version: lmc?.modelVersion ?? process.env.INTAKE_LLM_MODEL ?? 'unknown',
    enabled: true,
    min_confidence: 0,
  }
  if (idx >= 0) stages[idx] = { ...stages[idx], ...fixed }
  else stages.push(fixed)
  // Rules-first coverage: the rule engine must run BEFORE the model so every
  // message gets an instant classification and the model only escalates. An earlier
  // model-first backfill may have persisted the model ahead of the rule stage —
  // move it back after the rules so stored configs self-heal on the next run.
  const ruleIdx = stages.findIndex((s) => s.provider === 'rule_engine' || s.stage === 'rule')
  const lmIdx = stages.findIndex((s) => s.stage === 'local_model')
  if (ruleIdx >= 0 && lmIdx >= 0 && lmIdx < ruleIdx) {
    const [lm] = stages.splice(lmIdx, 1)
    stages.push(lm)
  }
  return { ...config, stages }
}

// Classifies a single stored message: runs the enabled stages in order, persists
// one intake_classifications row per stage, marks the winner is_final, and
// creates/refreshes the intake_reviews row. Idempotent — safe to re-run (used by
// both live ingestion and the backfill endpoint).
export async function classifyMessage(
  messageId: string,
  preloadedConfig?: PipelineConfig,
  preloadedCustomRules?: ClassificationRule[],
  preloadedCatalog?: CatalogService[],
): Promise<boolean> {
  const { data: msg } = await supabase
    .from('intake_messages')
    .select('id, org_id, thread_id, channel_id, subject, from_address, normalized, body_text, recipient_type, intake_channels(type)')
    .eq('id', messageId)
    .maybeSingle()

  if (!msg) return false

  const normalizedText =
    (msg.normalized as { text?: string } | null)?.text ?? msg.body_text ?? ''
  const channelType = (msg as { intake_channels?: { type?: string } }).intake_channels?.type ?? 'email'

  const recipientType = (msg as { recipient_type?: string }).recipient_type as 'to' | 'cc' | undefined
  const env: IntakeEnvelope = {
    subject: msg.subject,
    text: normalizedText,
    sender: msg.from_address,
    channelType,
    recipientType,
  }

  const config = preloadedConfig ?? await loadConfig(msg.org_id)
  const customRules = preloadedCustomRules ?? await loadCustomRules(msg.org_id)
  const ruleEngine = ruleEngineFor(customRules)
  const catalog = preloadedCatalog ?? await loadCatalog(msg.org_id)

  // NOTE: we do NOT delete prior classification rows up front. The review's
  // classification_id has ON DELETE SET NULL, so deleting before a successful
  // re-run would orphan the review ("Unclassified") if this run produced nothing
  // (e.g. a classifier threw, or an insert failed). Instead we insert the new
  // rows, and only prune the stale ones once we have a confirmed winner.
  const newClassificationIds: string[] = []

  let best: { id: string; confidence: number } | null = null
  let bestResult = null as Awaited<ReturnType<Classifier['classify']>> | null

  for (const stage of config.stages.filter((s) => s.enabled)) {
    // Resolve the classifier by provider, falling back to the stage name. The
    // settings page stamps the real vendor (e.g. 'groq') into stage.provider for
    // display, but REGISTRY is keyed by the stable stage id ('local_model'), so
    // a provider lookup alone would miss it and silently skip Stage 2.
    const classifier = stage.provider === 'rule_engine'
      ? ruleEngine
      : REGISTRY[stage.provider] ?? REGISTRY[stage.stage]
    if (!classifier) {
      log.warn(`no classifier registered for stage '${stage.stage}' (provider '${stage.provider}') — skipping`)
      continue
    }

    const started = Date.now()
    let result
    try {
      result = await classifier.classify(env)
    } catch (err) {
      log.warn(`classifier ${stage.provider} failed`, err instanceof Error ? err.message : err)
      continue // stage isolation: fall back to best-so-far
    }
    const latency = Date.now() - started

    const { data: row } = await supabase
      .from('intake_classifications')
      .insert({
        org_id: msg.org_id,
        message_id: messageId,
        stage: classifier.stage,
        provider: classifier.provider,
        model_version: classifier.modelVersion,
        suggested_type: result.suggestedType,
        suggested_department: result.suggestedDepartment,
        suggested_category: result.suggestedCategory,
        suggested_subcategory: result.suggestedSubcategory,
        suggested_priority: result.suggestedPriority,
        confidence: Math.round(result.confidence),
        evidence: result.evidence,
        entities: result.entities ?? {},
        rationale: result.rationale,
        latency_ms: latency,
        cost_microcents: Math.round(result.costMicrocents ?? 0),
      })
      .select('id, confidence')
      .single()

    if (row) {
      newClassificationIds.push(row.id)
      if (best === null || row.confidence > best.confidence) {
        best = row
        bestResult = result
      }
    }

    // Stop conditions, in order:
    //  1. Clearly good enough to auto-accept.
    //  2. Confident no-work mail (FYI/junk) — never worth a paid Stage-2 call,
    //     even when the escalation bar sits above the no-work confidence floor.
    //  3. Good enough that we don't escalate further.
    if (best && best.confidence >= config.auto_accept_at_confidence) break
    if (best && bestResult && NO_WORK_TYPES.has(bestResult.suggestedType) && best.confidence >= AUTO_RESOLVE_CONFIDENCE) break
    if (best && best.confidence >= config.escalate_below_confidence) break
  }

  if (!best || !bestResult) {
    // Leave any pre-existing classification + review intact rather than orphaning.
    log.warn(`no classification produced for message ${messageId} — keeping prior result`)
    return false
  }

  // Now safe to prune stale rows from earlier runs (FK will SET NULL on the
  // review, but we re-point it to the new winner immediately below).
  await supabase
    .from('intake_classifications')
    .delete()
    .eq('message_id', messageId)
    .not('id', 'in', `(${newClassificationIds.join(',')})`)

  // Mark the winning classification row.
  await supabase.from('intake_classifications').update({ is_final: true }).eq('id', best.id)

  // ── Meta-signal priority overrides ────────────────────────────────────────
  // 1. CC'd messages are for awareness, not action — cap to low unless urgent.
  // 2. Thread follow-up: another unresolved review exists in the same thread,
  //    meaning previous mail was missed → bump to at least high.
  let adjustedPriority = bestResult.suggestedPriority
  if (recipientType === 'cc' && adjustedPriority !== 'urgent') {
    adjustedPriority = 'low'
  }
  if (msg.thread_id) {
    const { count: threadPending } = await supabase
      .from('intake_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', msg.org_id)
      .eq('thread_id', msg.thread_id)
      .in('state', ['pending', 'in_review'])
      .neq('message_id', messageId)
    if ((threadPending ?? 0) > 0 && (adjustedPriority === 'low' || adjustedPriority === 'medium')) {
      adjustedPriority = 'high'
    }
  }

  // Auto-resolve confident no-work mail (FYI / junk) so it never clogs the human
  // review queue. reviewed_by stays null to mark it as a machine decision (so a
  // later forced re-classify can still revisit it — see classifyBacklog).
  let confidence = Math.round(bestResult.confidence)
  const autoResolve = NO_WORK_TYPES.has(bestResult.suggestedType) && confidence >= AUTO_RESOLVE_CONFIDENCE
  const resolvedAt = autoResolve ? new Date().toISOString() : null

  // F2: resolve a real catalog service for actionable mail so conversion reuses
  // the service's team/priority/form fields. Suggestion only — reviewer overrides.
  const svcMatch = ACTIONABLE_TYPES.has(bestResult.suggestedType)
    ? resolveService(env, bestResult.suggestedCategory, catalog)
    : null

  // F3: a catalog match is an independent signal that this is real, actionable
  // work — corroboration, so nudge confidence up (never past auto-accept on its
  // own). No effect on no-work mail (svcMatch is null there).
  if (svcMatch) confidence = Math.min(89, confidence + 8)

  // Create or refresh the review row. SUGGESTED snapshot + FINAL seeded from it.
  const reviewRow = {
    org_id: msg.org_id,
    message_id: messageId,
    thread_id: msg.thread_id,
    state: (autoResolve ? 'approved' : 'pending') as 'approved' | 'pending',
    classification_id: best.id,
    suggested_type: bestResult.suggestedType,
    suggested_department: bestResult.suggestedDepartment,
    suggested_category: bestResult.suggestedCategory,
    suggested_subcategory: bestResult.suggestedSubcategory,
    suggested_priority: adjustedPriority,
    suggested_confidence: confidence,
    suggested_service_id: svcMatch?.serviceId ?? null,
    suggested_category_id: svcMatch?.categoryId ?? null,
    suggested_team_id: svcMatch?.teamId ?? null,
    final_type: bestResult.suggestedType,
    final_department: bestResult.suggestedDepartment,
    final_category: bestResult.suggestedCategory,
    final_subcategory: bestResult.suggestedSubcategory,
    final_priority: adjustedPriority,
    was_overridden: false,
    reviewed_at: resolvedAt,
  }

  // Upsert on the unique message_id. Don't clobber a review already actioned by a human.
  const { data: existing } = await supabase
    .from('intake_reviews')
    .select('id, state, reviewed_by, classification_id')
    .eq('message_id', messageId)
    .maybeSingle()

  // Safe to refresh when the reviewer hasn't started (pending) or when the row
  // was auto-resolved by the machine (approved + no human). Human decisions stay.
  const refreshable = existing && (existing.state === 'pending'
    || (existing.state === 'approved' && existing.reviewed_by === null))

  if (!existing) {
    await supabase.from('intake_reviews').insert(reviewRow)
  } else if (!refreshable && existing.classification_id === null) {
    // A human-actioned review whose classification pointer was orphaned (e.g. by
    // an older delete-before-reclassify bug). Repair just the pointer so it leaves
    // the "Unclassified" bucket — never touch the human's decision fields.
    await supabase.from('intake_reviews')
      .update({ classification_id: best.id })
      .eq('id', existing.id)
  } else if (refreshable) {
    // Rewrite suggestions and state — may flip pending↔approved as the new
    // classification crosses (or drops below) the auto-resolve bar.
    await supabase.from('intake_reviews').update({
      state: reviewRow.state,
      reviewed_at: reviewRow.reviewed_at,
      classification_id: reviewRow.classification_id,
      suggested_type: reviewRow.suggested_type,
      suggested_department: reviewRow.suggested_department,
      suggested_category: reviewRow.suggested_category,
      suggested_subcategory: reviewRow.suggested_subcategory,
      suggested_priority: reviewRow.suggested_priority,
      suggested_confidence: reviewRow.suggested_confidence,
      suggested_service_id: reviewRow.suggested_service_id,
      suggested_category_id: reviewRow.suggested_category_id,
      suggested_team_id: reviewRow.suggested_team_id,
      final_type: reviewRow.final_type,
      final_department: reviewRow.final_department,
      final_category: reviewRow.final_category,
      final_subcategory: reviewRow.final_subcategory,
      final_priority: reviewRow.final_priority,
    }).eq('id', existing.id)
  }

  // Junk (ignore) gets archived out of the inbox entirely; FYI stays visible in
  // the Information folder. Actionable mail keeps the neutral 'classified' status.
  const messageUpdate: Record<string, unknown> = { status: 'classified' }
  if (autoResolve && bestResult.suggestedType === 'ignore') messageUpdate.is_archived = true
  await supabase.from('intake_messages').update(messageUpdate).eq('id', messageId)
  return true
}

// Backfill / bulk classification.
//   force=false → only messages with NO review yet (first-time backfill).
//   force=true  → also RE-process messages whose review is still 'pending'
//                 (un-actioned), so pipeline changes (e.g. adding Stage 2) take
//                 effect. Human-actioned reviews (in_review/approved/converted/
//                 rejected) are always left untouched.
export async function classifyBacklog(limit = 1000, force = false, unclassifiedOnly = false): Promise<{ processed: number; escalated: number; skipped: number }> {
  // Fetch messages without join to avoid PostgREST limiting joined results
  let query = supabase
    .from('intake_messages')
    .select('id, org_id, status')

  // Heal path: target only mail that hasn't been classified yet (status stays
  // 'new'/'normalized' until classifyMessage stamps 'classified'). Without this
  // the oldest `limit` rows — often already classified — fill the page and newer
  // unclassified mail past the limit is never reached, so the backlog stalls.
  if (unclassifiedOnly) query = query.in('status', ['new', 'normalized'])

  query = query
    .order('received_at', { ascending: true })
    .limit(limit)

  const { data: messages, error: queryErr } = await query
  if (queryErr) {
    log.error('classifyBacklog query failed', queryErr)
    return { processed: 0, escalated: 0, skipped: 0 }
  }
  log.info(`classifyBacklog: fetched ${messages?.length ?? 0} unclassified messages (limit=${limit})`)

  // Fetch all reviews for these messages in a single query
  const messageIds = (messages ?? []).map((m) => m.id)
  if (!messageIds.length) {
    log.info(`classifyBacklog: no unclassified messages to process`)
    return { processed: 0, escalated: 0, skipped: 0 }
  }

  const { data: reviewRows } = await supabase
    .from('intake_reviews')
    .select('message_id, id, state, reviewed_by, classification_id, suggested_confidence')
    .in('message_id', messageIds)

  const reviewMap = new Map((reviewRows ?? []).map((r) => [r.message_id, r]))

  // Messages that have ALREADY been to Stage 2 (a local_model row exists). In a
  // force re-run we skip these so repeated or interrupted runs make forward
  // progress instead of re-burning the LLM rate limit on the same messages every
  // time. This is what makes the backfill resumable: each Stage-2 call happens at
  // most once, so clicking Re-classify again simply continues where it left off.
  const { data: escalatedRows } = await supabase
    .from('intake_classifications')
    .select('message_id')
    .eq('stage', 'local_model')
  const alreadyEscalated = new Set((escalatedRows ?? []).map((r) => (r as { message_id: string }).message_id))

  type Row = { id: string; org_id: string; status: string }
  let skipped = 0
  const eligible = (messages as Row[] ?? []).filter((r) => {
    const review = reviewMap.get(r.id)
    if (!review) return true                       // never classified → always
    // An orphaned review (no classification pointer — the "Unclassified" bucket)
    // is always re-run to repair itself, even for human-actioned rows. The repair
    // only re-points classification_id; the human decision is preserved.
    if (review.classification_id === null) return true
    if (!force) return false
    // Resumable: don't re-escalate what's already been through Stage 2.
    if (alreadyEscalated.has(r.id)) { skipped++; return false }
    // Re-run un-actioned reviews, plus machine-auto-resolved ones (approved with
    // no human reviewer) so rule/config changes still reach FYI mail. A human
    // decision (reviewed_by set, or in_review/rejected/converted) is left intact.
    if (review.state === 'pending') return true
    return review.state === 'approved' && review.reviewed_by === null
  })

  // Escalation-first ordering: process the lowest-confidence (most likely to
  // escalate) mail before the high-confidence bulk. This front-loads the valuable
  // — and slow, rate-limited — Stage-2 work, so even a short-lived run gets the
  // actionable mail done first. Unclassified (null confidence) sorts first.
  eligible.sort((a, b) => {
    const ca = reviewMap.get(a.id)?.suggested_confidence ?? -1
    const cb = reviewMap.get(b.id)?.suggested_confidence ?? -1
    return ca - cb
  })
  log.info(`classifyBacklog: ${eligible.length} eligible messages (fetched=${messages?.length}, skipped=${skipped}, alreadyEscalated=${alreadyEscalated.size})`)

  // Pre-load pipeline config + custom rules + catalog once per org (typically one).
  const configCache: Record<string, PipelineConfig> = {}
  const coverageCache: Record<string, PipelineConfig> = {}
  const rulesCache: Record<string, ClassificationRule[]> = {}
  const catalogCache: Record<string, CatalogService[]> = {}

  let processed = 0
  for (let i = 0; i < eligible.length; i++) {
    const r = eligible[i]
    try {
      if (!configCache[r.org_id]) {
        log.info(`classifyBacklog: loading config for org ${r.org_id}`)
        configCache[r.org_id] = await loadConfig(r.org_id)
        rulesCache[r.org_id] = await loadCustomRules(r.org_id)
        catalogCache[r.org_id] = await loadCatalog(r.org_id)
        // Coverage pass = rules only. The bulk backlog must NOT call the rate-limited
        // model inline — that's what left mail unclassified ("No review detail"). Rules
        // give every message an instant classification here; the model upgrades
        // uncertain actionable mail separately via escalateCatchUp (resumable,
        // rate-limit-safe), so coverage is never blocked behind a slow LLM call.
        coverageCache[r.org_id] = {
          ...configCache[r.org_id],
          stages: configCache[r.org_id].stages.filter((s) => s.provider === 'rule_engine' || s.stage === 'rule'),
        }
        // Persist the live pipeline config (with real Stage-2 provider + model) to the
        // DB so the settings page can read Stage-2 status without Railway env vars.
        await supabase
          .from('intake_pipeline_config')
          .upsert({ org_id: r.org_id, config: configCache[r.org_id] }, { onConflict: 'org_id' })
      }
      log.info(`classifyBacklog: processing message ${i + 1}/${eligible.length} (id=${r.id.slice(0, 8)})`)
      const ok = await classifyMessage(r.id, coverageCache[r.org_id], rulesCache[r.org_id], catalogCache[r.org_id])
      if (ok) processed++
    } catch (err) {
      log.error(`classifyBacklog: error processing message ${i + 1}/${eligible.length} (id=${r.id.slice(0, 8)})`, err instanceof Error ? err.message : err)
      // Continue processing remaining messages instead of aborting
    }
  }
  // Count how many reached Stage 2 this run (local_model rows now vs before).
  const { count: escalatedNow } = await supabase
    .from('intake_classifications')
    .select('message_id', { count: 'exact', head: true })
    .eq('stage', 'local_model')
  const escalated = Math.max(0, (escalatedNow ?? 0) - alreadyEscalated.size)
  log.info(`classifyBacklog complete: fetched=${messages?.length}, eligible=${eligible.length}, processed=${processed}/${eligible.length}, escalated=${escalated}, skipped=${skipped} (force=${force})`)
  return { processed, escalated, skipped }
}

// Auto-escalation catch-up. Each scheduled tick sends a small batch of the
// lowest-confidence ACTIONABLE mail that hasn't been to Stage 2 yet through the
// full pipeline. This clears an escalation backlog gradually and restart-safely
// (a handful per tick, skipping anything already escalated) instead of relying on
// one long manual re-classify that dies on every worker redeploy. New mail
// already escalates on arrival via the ingestion path; this only catches up the
// history that was classified before Stage 2 was reachable.
//
// Only actionable types are candidates — no-work mail (FYI/junk) is intentionally
// kept on the rules engine, so it never becomes a permanently-retried candidate.
export async function escalateCatchUp(batchSize = 25): Promise<{ escalated: number }> {
  if (!localModelConfigured()) return { escalated: 0 }

  const { data: escalatedRows } = await supabase
    .from('intake_classifications')
    .select('message_id')
    .eq('stage', 'local_model')
  const escalated = new Set((escalatedRows ?? []).map((r) => (r as { message_id: string }).message_id))

  // Below the default escalation bar (85) and actionable → wants a Stage-2 opinion.
  const { data: candidates } = await supabase
    .from('intake_reviews')
    .select('message_id, state, reviewed_by, suggested_confidence')
    .in('suggested_type', ['request', 'task', 'approval'])
    .lt('suggested_confidence', 85)
    .order('suggested_confidence', { ascending: true })
    .limit(batchSize * 3)

  type Cand = { message_id: string; state: string; reviewed_by: string | null; suggested_confidence: number | null }
  const todo = (candidates as Cand[] ?? [])
    .filter((r) => !escalated.has(r.message_id))
    // Only un-actioned or machine-auto-resolved rows — never touch human decisions.
    .filter((r) => r.state === 'pending' || (r.state === 'approved' && r.reviewed_by === null))
    .slice(0, batchSize)

  let done = 0
  for (const r of todo) {
    if (await classifyMessage(r.message_id)) done++
  }
  if (todo.length) log.info(`escalation catch-up: processed ${done}/${todo.length} actionable messages`)
  return { escalated: done }
}
