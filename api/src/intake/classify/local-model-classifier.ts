import type { Classifier, ClassificationResult, IntakeEnvelope, WorkType, Priority } from './types.js'
import { deriveTaxonomy, type Taxonomy } from './ruleset.js'
import { log } from '../../lib/log.js'

// Stage 2 — Local / open-weight model classifier.
//
// Talks to any OpenAI-compatible chat-completions endpoint (Groq, Together,
// Fireworks, OpenRouter, a self-hosted vLLM, …). Configured purely by env so
// swapping providers never touches code:
//
//   INTAKE_LLM_API_KEY   required — enables the stage when present
//   INTAKE_LLM_BASE_URL  default https://api.groq.com/openai/v1
//   INTAKE_LLM_MODEL     default llama-3.3-70b-versatile
//   INTAKE_LLM_PROVIDER  label only, default 'groq'
//
// Implements the SAME Classifier contract as the rule engine — orchestrator,
// schema and UI are untouched. Output is constrained to the shared taxonomy so
// its results are directly comparable with Stage 1.

const VALID_TYPES: WorkType[] = ['request', 'task', 'approval', 'informational', 'ignore']
const VALID_PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent']

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_MODEL = 'llama-3.3-70b-versatile'
// Keep the prompt cheap — the body is pre-normalized, and triage rarely needs
// more than the opening of the message. Smaller prompts also mean more calls fit
// under a provider's tokens-per-minute limit (key for Groq's free tier). Tune
// via env without a deploy.
const MAX_BODY_CHARS = Number(process.env.INTAKE_LLM_MAX_BODY_CHARS ?? '1800')

// Rough USD price per 1M tokens (input/output). Used only for the cost estimate
// shown in the validation table — override via env when prices change. Defaults
// track Groq llama-3.3-70b (free tier = $0; these are the paid rates). 1 microcent = 1e-8 USD.
const PRICE_IN_PER_M  = Number(process.env.INTAKE_LLM_PRICE_IN_PER_M  ?? '0.59')
const PRICE_OUT_PER_M = Number(process.env.INTAKE_LLM_PRICE_OUT_PER_M ?? '0.79')

function estimateMicrocents(promptTokens: number, completionTokens: number): number {
  const usd = (promptTokens / 1e6) * PRICE_IN_PER_M + (completionTokens / 1e6) * PRICE_OUT_PER_M
  return usd * 1e8 // USD → microcents (1 cent = 1e6 microcents)
}

// Free tiers throttle hard, so space out calls and retry transient 429/5xx.
// Min gap between calls (~15 RPM default) keeps bulk backlog runs under limits.
const MIN_INTERVAL_MS = Number(process.env.INTAKE_LLM_MIN_INTERVAL_MS ?? '4000')
const MAX_RETRIES = Number(process.env.INTAKE_LLM_MAX_RETRIES ?? '3')

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Module-level gate: sequential backlog calls are naturally spaced by this.
let nextAllowedAt = 0
async function throttle(): Promise<void> {
  const now = Date.now()
  if (now < nextAllowedAt) await sleep(nextAllowedAt - now)
  nextAllowedAt = Date.now() + MIN_INTERVAL_MS
}

// True when an API key is configured. The orchestrator uses this to decide
// whether to register/enable the stage at all.
export function localModelConfigured(): boolean {
  return Boolean(process.env.INTAKE_LLM_API_KEY)
}

interface ModelJson {
  type?: string
  department?: string | null
  category?: string | null
  subcategory?: string | null
  priority?: string
  confidence?: number
  rationale?: string
}

export class LocalModelClassifier implements Classifier {
  readonly stage = 'local_model' as const
  readonly provider: string
  readonly modelVersion: string
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly model: string
  private readonly taxonomy: Taxonomy

  constructor(taxonomy: Taxonomy = deriveTaxonomy()) {
    this.apiKey = process.env.INTAKE_LLM_API_KEY ?? ''
    this.baseUrl = (process.env.INTAKE_LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.model = process.env.INTAKE_LLM_MODEL ?? DEFAULT_MODEL
    this.provider = process.env.INTAKE_LLM_PROVIDER ?? 'groq'
    this.modelVersion = this.model
    this.taxonomy = taxonomy
  }

  async classify(env: IntakeEnvelope): Promise<ClassificationResult> {
    if (!this.apiKey) throw new Error('INTAKE_LLM_API_KEY not set')

    const body = (env.text ?? '').slice(0, MAX_BODY_CHARS)
    const prompt = this.buildUserPrompt(env.subject, body, env.sender, env.channelType)

    const reqBody = JSON.stringify({
      model: this.model,
      temperature: 0,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: this.systemPrompt() },
        { role: 'user', content: prompt },
      ],
    })

    const started = Date.now()
    const res = await this.fetchWithRetry(reqBody)

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`LLM ${res.status}: ${detail.slice(0, 200)}`)
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number }
    }
    const raw = data.choices?.[0]?.message?.content ?? ''
    const parsed = this.parse(raw)

    const promptTokens = data.usage?.prompt_tokens ?? 0
    const completionTokens = data.usage?.completion_tokens ?? 0
    const costMicrocents = estimateMicrocents(promptTokens, completionTokens)

    const suggestedType = this.coerceType(parsed.type)
    const suggestedPriority = this.coercePriority(parsed.priority)
    const suggestedDepartment = this.coerceSlug(parsed.department, this.taxonomy.departments)
    const suggestedCategory = this.coerceSlug(parsed.category, this.taxonomy.categories)
    const confidence = this.coerceConfidence(parsed.confidence)

    log.info(`local_model classify => ${suggestedType}/${suggestedDepartment ?? '-'} @${confidence}% in ${Date.now() - started}ms`)

    return {
      suggestedType,
      suggestedDepartment,
      suggestedCategory,
      suggestedSubcategory:
        typeof parsed.subcategory === 'string' && parsed.subcategory.trim()
          ? parsed.subcategory.trim().toLowerCase()
          : null,
      suggestedPriority,
      confidence,
      evidence: {
        engine: 'local_model',
        provider: this.provider,
        model: this.model,
        raw_type: parsed.type ?? null,
        raw_department: parsed.department ?? null,
        tokens: data.usage?.total_tokens ?? null,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
      },
      rationale: parsed.rationale?.slice(0, 500) ?? 'Model returned no rationale.',
      costMicrocents,
    }
  }

  // Throttled + retrying POST. Spaces calls to respect free-tier RPM, and retries
  // 429 / 5xx with exponential backoff (honouring Retry-After when supplied).
  private async fetchWithRetry(reqBody: string): Promise<Response> {
    let lastRes: Response | null = null
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await throttle()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 20_000)
      let res: Response
      try {
        res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
          body: reqBody,
          signal: controller.signal,
        })
      } catch (err) {
        clearTimeout(timeout)
        if ((err as Error)?.name === 'AbortError') throw new Error('LLM request timed out after 20s')
        throw err
      }
      clearTimeout(timeout)
      if (res.ok || (res.status !== 429 && res.status < 500)) return res

      lastRes = res
      if (attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : MIN_INTERVAL_MS * Math.pow(2, attempt)
        log.warn(`local_model ${res.status} — retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`)
        await sleep(backoff)
      }
    }
    return lastRes as Response
  }

  // ── Prompting ─────────────────────────────────────────────────────────────

  private systemPrompt(): string {
    return [
      'You are an email triage classifier for a workplace operations system.',
      'Classify the inbound message into the work item it should become.',
      'Respond with a SINGLE JSON object and nothing else.',
      '',
      'Fields:',
      '- type: one of request | task | approval | informational | ignore.',
      '    request       = the sender explicitly asks ANOTHER function/department to',
      '                    fulfil a service (e.g. raise/process/issue/provide/grant/fix).',
      '                    This is the EXCEPTION, not the default. Only use it when there',
      '                    is a clear ask directed at a service team.',
      '    task          = an actionable to-do for the RECEIVING team itself.',
      '    approval      = explicit ask for sign-off / authorization.',
      '    informational = FYI / CC / notification / receipt / status update / newsletter-style',
      '                    but legitimate. No action required. THIS IS THE DEFAULT for most mail.',
      '    ignore        = junk: auto-reply, out-of-office, no-reply blast, spam, promotion.',
      '',
      'Decision guide: if nobody is explicitly asking the recipient to DO something,',
      'it is informational — never invent a request. A notification, receipt, confirmation,',
      'or "for your information" mail is informational, even if it mentions money/HR/IT topics.',
      `- department: one of [${this.taxonomy.departments.join(', ')}] or null if unclear.`,
      `- category: one of [${this.taxonomy.categories.join(', ')}] or null if unclear.`,
      '- subcategory: a short lowercase slug or null.',
      '- priority: one of low | medium | high | urgent.',
      '- confidence: integer 0-100, how sure you are overall.',
      '- rationale: one short sentence explaining the decision.',
      '',
      'Use ONLY the allowed department/category values. If none fit, use null.',
      'Be conservative: prefer ignore for clearly automated/marketing mail.',
    ].join('\n')
  }

  private buildUserPrompt(subject: string | null, body: string, sender: string | null, channel: string): string {
    return [
      `Channel: ${channel}`,
      `From: ${sender ?? '(unknown)'}`,
      `Subject: ${subject ?? '(no subject)'}`,
      '',
      'Body:',
      body || '(empty)',
    ].join('\n')
  }

  // ── Parsing / coercion ────────────────────────────────────────────────────

  private parse(raw: string): ModelJson {
    try {
      return JSON.parse(raw) as ModelJson
    } catch {
      // Some models wrap JSON in prose or fences — extract the first object.
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) {
        try { return JSON.parse(match[0]) as ModelJson } catch { /* fall through */ }
      }
      log.warn('local_model returned unparseable JSON', raw.slice(0, 200))
      return {}
    }
  }

  private coerceType(v: unknown): WorkType {
    const t = String(v ?? '').toLowerCase().trim()
    return (VALID_TYPES as string[]).includes(t) ? (t as WorkType) : 'ignore'
  }

  private coercePriority(v: unknown): Priority {
    const p = String(v ?? '').toLowerCase().trim()
    return (VALID_PRIORITIES as string[]).includes(p) ? (p as Priority) : 'medium'
  }

  private coerceSlug(v: unknown, allowed: string[]): string | null {
    if (v == null) return null
    const s = String(v).toLowerCase().trim()
    if (!s || s === 'null' || s === 'none') return null
    return allowed.includes(s) ? s : null
  }

  private coerceConfidence(v: unknown): number {
    const n = Number(v)
    if (!Number.isFinite(n)) return 50
    return Math.max(0, Math.min(100, Math.round(n)))
  }
}
