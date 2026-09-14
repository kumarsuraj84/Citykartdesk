'use server'

import { requireModuleEnabled } from '@/lib/actions/moduleGuard'

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_MODEL    = 'llama-3.3-70b-versatile'
const MAX_BODY_CHARS   = 2000

const SYSTEM_PROMPT = `You are a concise email summarizer for a workplace operations team.
Summarize the email in 2-3 short sentences. Focus on:
- What the sender needs or is communicating
- Any required action, deadline, or next step
- Key details (names, amounts, dates) if present

Be direct. Do not start with "This email…" — state the key points immediately.
Respond with only the summary text, nothing else.`

export async function generateEmailBrief(
  subject: string | null,
  bodyText: string | null,
  fromAddress: string | null,
): Promise<{ brief: string | null; error?: string }> {
  // NOTE: unlike every other intake action, this one has no getCurrentProfile()
  // auth check at all — out of scope for the module-gate fix this pass is
  // making (see CITYKART-DESK-CONSOLIDATED-REMEDIATION-REPORT-2026-09-10.md,
  // "Intake Module Guard" section), flagged there as a separate follow-up
  // rather than fixed here to stay within this pass's assigned scope.
  const moduleError = await requireModuleEnabled('intake')
  if (moduleError) return { brief: null, error: moduleError }

  const apiKey = process.env.INTAKE_LLM_API_KEY
  if (!apiKey) return { brief: null, error: 'not_configured' }

  const baseUrl = (process.env.INTAKE_LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  const model   = process.env.INTAKE_LLM_MODEL ?? DEFAULT_MODEL

  const body = (bodyText ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_BODY_CHARS)
  if (!body && !subject) return { brief: null }

  const userMessage = `Subject: ${subject ?? '(none)'}
From: ${fromAddress ?? 'unknown'}

${body}`

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 150,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { brief: null, error: `api_${res.status}: ${detail.slice(0, 100)}` }
    }

    const data = await res.json() as {
      choices?: { message?: { content?: string } }[]
    }
    const brief = data.choices?.[0]?.message?.content?.trim() ?? null
    return { brief }
  } catch {
    return { brief: null, error: 'timeout_or_network' }
  }
}
