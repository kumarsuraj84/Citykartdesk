import type { FormField } from '@/types'
import { validateFieldValue } from '@/lib/validation/formFields'

export type ApplyAnswerResult =
  | { ok: true; answers: Record<string, unknown> }
  | { ok: false; error: string }

// DD/MM/YYYY (optionally D/M/YYYY) — matches exactly what the WhatsApp
// prompt asks for (see lib/whatsapp/render.ts's date prompt: "Format:
// DD/MM/YYYY"). Deliberately only this one separator/order — no ambiguous
// M/D/Y-vs-D/M/Y guessing.
const CONVERSATIONAL_DATE_REGEX = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

function normalizeAnswerValue(field: FormField, rawValue: unknown): unknown {
  switch (field.type) {
    case 'date': {
      // Channel-neutral normalization (Stage 7.1, F-01): converts the
      // conversational engine's own DD/MM/YYYY prompt format to the
      // canonical YYYY-MM-DD storage format shared with the web form's
      // native <input type="date">, BEFORE validateFieldValue() ever sees
      // it — validateFieldValue() itself only ever accepts the canonical
      // format, for every channel. A value already in canonical format (or
      // anything else) passes through unchanged; validateFieldValue() is
      // the single source of truth for whether it's actually valid.
      if (typeof rawValue !== 'string') return rawValue
      const trimmed = rawValue.trim()
      const match = trimmed.match(CONVERSATIONAL_DATE_REGEX)
      if (!match) return trimmed
      const [, d, m, y] = match
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    }

    case 'text':
    case 'textarea':
    case 'email':
    case 'phone':
      // A ticket-form `phone` field is independent free-text requester input
      // — NEVER auto-substituted with the Stage 2 mobile identity
      // (profiles.mobile_number/resolveUserByWhatsAppNumber()), which is a
      // separate WhatsApp-sender-identity concept entirely. See
      // STAGE_3_REPORT.md and Stage 2's own docs for why the two must not be
      // conflated.
      return typeof rawValue === 'string' ? rawValue.trim() : rawValue

    case 'number': {
      if (typeof rawValue === 'string' && rawValue.trim() !== '') {
        const n = Number(rawValue.trim())
        return Number.isNaN(n) ? rawValue.trim() : n
      }
      return rawValue
    }

    case 'checkbox':
    case 'toggle': {
      // Boolean semantics for both — confirmed via FieldRenderer.tsx audit:
      // checkbox always renders as a plain boolean (never with options); the
      // web renderer doesn't handle `toggle` at all today (a pre-existing
      // gap, unrelated to this engine), but it's the same boolean concept, so
      // a conversational "yes"/"no" answer is modeled identically here.
      if (typeof rawValue === 'string') {
        const v = rawValue.trim().toLowerCase()
        if (['yes', 'y', 'true', '1'].includes(v)) return true
        if (['no', 'n', 'false', '0'].includes(v)) return false
      }
      return !!rawValue
    }

    case 'multiselect':
      return Array.isArray(rawValue) ? rawValue : rawValue == null ? [] : [rawValue]

    default:
      return rawValue
  }
}

/**
 * Step 12: normalizes + validates one conversational answer against its
 * field's type/options/validation config using validateFieldValue() — the
 * exact same shared validator the web form and Email Intake both use
 * (including the Step 11 option-membership hardening), so a select/radio/
 * multiselect answer collected through a future WhatsApp conversation is held
 * to the same standard as one picked from a real dropdown. Returns a NEW
 * answers object; never mutates the input.
 */
export function applyQuestionAnswer(params: {
  field: FormField
  rawValue: unknown
  answers: Record<string, unknown>
}): ApplyAnswerResult {
  const { field, rawValue, answers } = params

  // Required-file handling (Step 13): this engine has no attachment-transport
  // mechanism (no Meta/WhatsApp code), so a `file` answer is never accepted —
  // no fake form_data, no dummy attachment. See question-plan.ts's doc
  // comment for how the field still surfaces in the plan despite this.
  if (field.type === 'file') {
    return { ok: false, error: `${field.label} requires a file attachment, which this engine does not yet collect.` }
  }
  if (field.type === 'store_address') {
    return { ok: false, error: `${field.label} is system-populated and cannot be answered directly.` }
  }

  const normalized = normalizeAnswerValue(field, rawValue)
  const message = validateFieldValue(field, normalized, 'requester')
  if (message) return { ok: false, error: message }

  return { ok: true, answers: { ...answers, [field.id]: normalized } }
}
