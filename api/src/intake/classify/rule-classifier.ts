import type { Classifier, ClassificationResult, IntakeEnvelope, WorkType, Priority } from './types.js'
import { DEFAULT_RULES, RULESET_VERSION, type ClassificationRule } from './ruleset.js'
import { extractEntities } from './entities.js'

// Signal tiers (see docs/INTAKE-CLASSIFICATION-REDESIGN.md). Identity (the sender)
// and the subject are high-signal; body text is lower-signal and full of
// boilerplate, so its matches are discounted and can be suppressed entirely when
// the sender is an automated/bulk robot.
type Tier = 0 | 1 | 2 // 0 = sender, 1 = subject, 2 = body
const SENDER: Tier = 0
const SUBJECT: Tier = 1
const BODY: Tier = 2
const TIER_FACTOR: Record<Tier, number> = { 0: 1, 1: 1, 2: 0.6 }

interface MatchRecord { key: string; terms: string[]; tier: Tier }

interface DimensionPick<T> {
  value: T | null
  weight: number            // effective (tier-adjusted) weight of the winning match
  tier: Tier
  matched: MatchRecord[]
  lockedByCustom: boolean   // set by an org custom rule — defaults can't override
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Word-boundary, case-insensitive keyword test. Returns matched terms.
function matchTerms(haystack: string, rule: ClassificationRule): string[] {
  if (!haystack) return []
  const found: string[] = []
  const hay = haystack.toLowerCase()
  for (const kw of rule.match.anyKeywords ?? []) {
    const k = kw.toLowerCase()
    // Multi-word phrases and address-like tokens (contain space, '@' or '_') use
    // substring; plain single tokens use a word boundary to avoid false hits.
    const isPhrase = /[\s@_]/.test(k)
    const hit = isPhrase ? hay.includes(k) : new RegExp(`\\b${escapeRegex(k)}\\b`, 'i').test(hay)
    if (hit) found.push(kw)
  }
  if (rule.match.regex) {
    try {
      if (new RegExp(rule.match.regex, 'i').test(haystack)) found.push(`/${rule.match.regex}/`)
    } catch { /* ignore bad pattern */ }
  }
  return found
}

// Remove footer/legal/unsubscribe boilerplate before matching the body, so link
// anchor text and marketing footers can't masquerade as content. Conservative:
// cut at the first footer marker, drop bare-URL lines.
function stripBoilerplate(text: string): string {
  if (!text) return ''
  const FOOTER = /unsubscribe|view (this )?(email|message) in|manage (your )?(preferences|subscription|account settings)|©|\(c\)\s|all rights reserved|privacy policy|terms of (service|use)|this (e-?mail|message) was sent|you (are )?receiv(e|ing) this|update your (email )?preferences|do not reply to this/i
  const out: string[] = []
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const t = raw.trim()
    if (/^https?:\/\/\S+$/i.test(t)) continue       // bare URL line
    if (FOOTER.test(t)) break                        // footer reached — drop the rest
    out.push(raw)
  }
  return out.join('\n').trim()
}

// Match a rule against the envelope, returning the HIGHEST (most trustworthy)
// tier it matched in, or null. 'both' (default) prefers subject over body.
function matchTiered(rule: ClassificationRule, sender: string, subject: string, body: string): { tier: Tier; terms: string[] } | null {
  const field = rule.match.field ?? 'both'
  const at = (hay: string, tier: Tier) => {
    const terms = matchTerms(hay, rule)
    return terms.length ? { tier, terms } : null
  }
  if (field === 'sender')  return at(sender, SENDER)
  if (field === 'subject') return at(subject, SUBJECT)
  if (field === 'text')    return at(body, BODY)
  if (field === 'all')     return at(sender, SENDER) ?? at(subject, SUBJECT) ?? at(body, BODY)
  return at(subject, SUBJECT) ?? at(body, BODY) // 'both'
}

// Stage 1 — deterministic Rule Engine. Implements the shared Classifier contract.
export class RuleClassifier implements Classifier {
  readonly stage = 'rule' as const
  readonly provider = 'rule_engine'
  readonly modelVersion = RULESET_VERSION
  private rules: ClassificationRule[]

  constructor(rules: ClassificationRule[] = DEFAULT_RULES) {
    // Evaluate org custom rules before defaults so they take precedence.
    this.rules = [...rules].sort((a, b) => Number(b.isCustom ?? false) - Number(a.isCustom ?? false))
  }

  async classify(env: IntakeEnvelope): Promise<ClassificationResult> {
    const sender = env.sender ?? ''
    const subject = env.subject ?? ''
    const body = stripBoilerplate(env.text ?? '')

    const mk = <T>() => ({ value: null, weight: 0, tier: BODY, matched: [], lockedByCustom: false }) as DimensionPick<T>
    const picks = {
      type:        mk<WorkType>(),
      department:  mk<string>(),
      category:    mk<string>(),
      subcategory: mk<string>(),
      priority:    mk<Priority>(),
    }

    // Was the no-work verdict set by the SENDER identity itself (a noreply/bulk
    // robot)? If so we suppress body-derived department/intent below.
    let senderNoWork = false

    // Rules are pre-sorted custom-first. A rule can output multiple dimensions.
    for (const rule of this.rules) {
      const hit = matchTiered(rule, sender, subject, body)
      if (!hit) continue
      const record: MatchRecord = { key: rule.key, terms: hit.terms, tier: hit.tier }
      const eff = rule.isCustom ? rule.weight : rule.weight * TIER_FACTOR[hit.tier]

      const consider = <T>(pick: DimensionPick<T>, val: T | undefined) => {
        if (val === undefined) return
        pick.matched.push(record)
        if (rule.isCustom) {
          if (!pick.lockedByCustom || eff > pick.weight) {
            pick.value = val; pick.weight = eff; pick.tier = hit.tier; pick.lockedByCustom = true
          }
          return
        }
        if (pick.lockedByCustom) return         // a custom rule already decided this dimension
        if (eff > pick.weight) { pick.value = val; pick.weight = eff; pick.tier = hit.tier }
      }
      consider(picks.type, rule.output.type)
      consider(picks.department, rule.output.department)
      consider(picks.category, rule.output.category)
      consider(picks.subcategory, rule.output.subcategory)
      consider(picks.priority, rule.output.priority)

      if (hit.tier === SENDER && (rule.output.type === 'informational' || rule.output.type === 'ignore')) {
        senderNoWork = true
      }
    }

    // ── Gating (the heart of the redesign) ──────────────────────────────────
    // 1. Automated/bulk sender → drop department/category/subcategory that came
    //    ONLY from the body. (A payments robot can't become an IT request because
    //    its footer says "sign in".) Subject/sender-tier topics survive.
    if (senderNoWork) {
      for (const p of [picks.department, picks.category, picks.subcategory] as DimensionPick<string>[]) {
        if (!p.lockedByCustom && p.value && p.tier === BODY) { p.value = null; p.weight = 0 }
      }
    }
    // 2. A subcategory needs a parent that a higher tier (sender/subject) chose —
    //    never tag 'access' off an incidental body keyword.
    if (picks.subcategory.value && !picks.subcategory.lockedByCustom) {
      const parentCorroborated = picks.department.value && picks.department.tier <= SUBJECT
      if (!parentCorroborated) { picks.subcategory.value = null; picks.subcategory.weight = 0 }
    }

    // Type comes from explicit INTENT only. With no intent signal, topical mail is
    // 'informational' — NOT a request. Junk markers set type=ignore via rules.
    const suggestedType: WorkType = picks.type.value ?? 'informational'
    const suggestedPriority: Priority = picks.priority.value ?? 'medium'

    const confidence = this.score(picks, suggestedType, senderNoWork)

    const rationaleParts: string[] = []
    if (picks.type.matched.length)  rationaleParts.push(`type=${suggestedType} (${flatTerms(picks.type)})`)
    if (picks.department.value)     rationaleParts.push(`dept=${picks.department.value} (${flatTerms(picks.department)})`)
    if (picks.category.value)       rationaleParts.push(`category=${picks.category.value}`)
    if (picks.priority.value)       rationaleParts.push(`priority=${suggestedPriority} (${flatTerms(picks.priority)})`)
    const rationale = rationaleParts.length ? rationaleParts.join('; ') : 'No rules matched — needs review'

    return {
      suggestedType,
      suggestedDepartment: picks.department.value,
      suggestedCategory: picks.category.value,
      suggestedSubcategory: picks.subcategory.value,
      suggestedPriority,
      confidence,
      evidence: {
        engine: 'rule',
        version: RULESET_VERSION,
        senderNoWork,
        matched: {
          type: picks.type.matched,
          department: picks.department.matched,
          category: picks.category.matched,
          priority: picks.priority.matched,
        },
      },
      rationale,
      // Structured hints from the FULL text (not the de-boilerplated body — IDs
      // and amounts often sit near the footer). Used to pre-fill form fields.
      entities: extractEntities(env.subject ?? null, env.text ?? null) as Record<string, unknown>,
    }
  }

  // Transparent 0–100 confidence based on CORROBORATION across tiers, not single
  // hits — so a lone body keyword stays low (and escalates) instead of reading as
  // confident. Still keeps no-work mail at/above the escalation threshold so it
  // doesn't cost a Stage-2 call.
  private score(
    picks: {
      type: DimensionPick<WorkType>; department: DimensionPick<string>; priority: DimensionPick<Priority>
    },
    resolvedType: WorkType,
    senderNoWork: boolean,
  ): number {
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
    const hasIntent = picks.type.matched.length > 0 && (resolvedType === 'request' || resolvedType === 'task' || resolvedType === 'approval')
    const deptCorroborated = !!picks.department.value && picks.department.tier <= SUBJECT

    // No actionable intent → informational/ignore. Trust the sender identity and
    // any subject-level topic; keep ≥ escalation threshold (70).
    if (!hasIntent) {
      let s = 72
      if (senderNoWork) s += 8           // a robot sender is a strong no-work signal
      if (deptCorroborated) s += 5       // topic confirmed by subject/sender (not body noise)
      return clamp(s)
    }

    // Actionable (request/task/approval) — reward corroboration.
    let s = 40
    s += Math.min(30, picks.type.weight * 3)
    if (deptCorroborated) s += 10
    if (picks.priority.value) s += 5
    // A single body-only intent signal is weak — cap it below auto-accept so the
    // pipeline escalates or a human reviews rather than trusting one footer verb.
    if (picks.type.tier === BODY && picks.type.matched.length === 1) s = Math.min(s, 60)
    return clamp(s)
  }
}

// Only show terms from the tier that actually won the dimension, so a discarded
// body match (e.g. a footer "sign in") doesn't appear in the explanation.
function flatTerms(pick: DimensionPick<unknown>): string {
  const terms = pick.matched.filter((m) => m.tier === pick.tier).flatMap((m) => m.terms)
  return [...new Set(terms)].join(', ')
}
