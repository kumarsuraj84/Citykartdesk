/**
 * Stage 7.1 — targeted tests for the UAT findings fixed in this stage:
 * F-01 (mandatory date accepts any string), F-02 (mandatory checkbox can't
 * be answered "No"), the Subject/Description semantic-role auto-fill, and
 * the WhatsApp source_channel gap. See STAGE_7_1_IMPLEMENTATION_REPORT.md.
 */
import { describe, it, expect } from 'vitest'
import { validateFieldValue, isFieldValueEmpty, isValidCanonicalDate } from '@/lib/validation/formFields'
import { applySemanticRoleAutofill } from '@/lib/requests/questionnaire/question-plan'
import { applyQuestionAnswer } from '@/lib/requests/questionnaire/answers'
import { sourceChannelOf } from '@/lib/rules/run'
import type { FormField } from '@/types'

function field(overrides: Partial<FormField> & Pick<FormField, 'id' | 'type' | 'label'>): FormField {
  return { required: false, order: 0, ...overrides }
}

describe('F-01: mandatory date validation', () => {
  it('isValidCanonicalDate: accepts a real calendar date in YYYY-MM-DD', () => {
    expect(isValidCanonicalDate('2026-09-11')).toBe(true)
  })
  it('isValidCanonicalDate: rejects an impossible date (Feb 31)', () => {
    expect(isValidCanonicalDate('2026-02-31')).toBe(false)
  })
  it('isValidCanonicalDate: rejects a non-date string', () => {
    expect(isValidCanonicalDate('not-a-real-date')).toBe(false)
  })
  it('isValidCanonicalDate: rejects a wrong-format string (DD/MM/YYYY, not canonical)', () => {
    expect(isValidCanonicalDate('11/09/2026')).toBe(false)
  })

  const dateField = field({ id: 'txn_date', type: 'date', label: 'Transaction Date', required: true })

  it('validateFieldValue: rejects "not-a-real-date" for a mandatory date field (Stage 7 F-01 repro)', () => {
    expect(validateFieldValue(dateField, 'not-a-real-date')).toBe('Enter a valid date for "Transaction Date" (YYYY-MM-DD).')
  })
  it('validateFieldValue: rejects an impossible calendar date', () => {
    expect(validateFieldValue(dateField, '2026-02-31')).toBe('Enter a valid date for "Transaction Date" (YYYY-MM-DD).')
  })
  it('validateFieldValue: rejects empty for a mandatory date field', () => {
    expect(validateFieldValue(dateField, '')).toBe('Transaction Date is required.')
  })
  it('validateFieldValue: accepts a valid canonical date', () => {
    expect(validateFieldValue(dateField, '2026-09-11')).toBeNull()
  })
})

describe('F-02: mandatory checkbox — false is a valid answer', () => {
  it('isFieldValueEmpty: false is NOT empty for a checkbox field', () => {
    expect(isFieldValueEmpty(false, 'checkbox')).toBe(false)
  })
  it('isFieldValueEmpty: false is NOT empty for a toggle field', () => {
    expect(isFieldValueEmpty(false, 'toggle')).toBe(false)
  })
  it('isFieldValueEmpty: undefined IS still empty for a checkbox field (never touched)', () => {
    expect(isFieldValueEmpty(undefined, 'checkbox')).toBe(true)
  })
  it('isFieldValueEmpty: null IS still empty for a checkbox field', () => {
    expect(isFieldValueEmpty(null, 'checkbox')).toBe(true)
  })
  it('isFieldValueEmpty: false is UNCHANGED (still empty) for every other field type — no global redefinition', () => {
    expect(isFieldValueEmpty(false)).toBe(true)
    expect(isFieldValueEmpty(false, 'text')).toBe(true)
    expect(isFieldValueEmpty(false, 'select')).toBe(true)
  })

  const checkboxField = field({ id: 'impact', type: 'checkbox', label: 'Business Impact Confirmed', required: true })

  it('validateFieldValue: a required checkbox answered false is VALID (Stage 7 F-02 repro fixed)', () => {
    expect(validateFieldValue(checkboxField, false)).toBeNull()
  })
  it('validateFieldValue: a required checkbox answered true is valid', () => {
    expect(validateFieldValue(checkboxField, true)).toBeNull()
  })
  it('validateFieldValue: a required checkbox left unanswered (undefined) is still rejected', () => {
    expect(validateFieldValue(checkboxField, undefined)).toBe('Business Impact Confirmed is required.')
  })

  it('applyQuestionAnswer: a conversational "no" answer normalizes to false and is accepted for a required checkbox', () => {
    const result = applyQuestionAnswer({ field: checkboxField, rawValue: 'no', answers: {} })
    expect(result).toEqual({ ok: true, answers: { impact: false } })
  })
})

describe('Conversational date normalization (DD/MM/YYYY -> YYYY-MM-DD, channel-neutral answers.ts layer)', () => {
  const dateField = field({ id: 'txn_date', type: 'date', label: 'Transaction Date', required: true })

  it('applyQuestionAnswer: converts a WhatsApp-format DD/MM/YYYY reply to canonical storage format', () => {
    const result = applyQuestionAnswer({ field: dateField, rawValue: '11/09/2026', answers: {} })
    expect(result).toEqual({ ok: true, answers: { txn_date: '2026-09-11' } })
  })
  it('applyQuestionAnswer: single-digit day/month DD/MM/YYYY still normalizes correctly', () => {
    const result = applyQuestionAnswer({ field: dateField, rawValue: '1/3/2026', answers: {} })
    expect(result).toEqual({ ok: true, answers: { txn_date: '2026-03-01' } })
  })
  it('applyQuestionAnswer: an already-canonical YYYY-MM-DD reply passes through unchanged', () => {
    const result = applyQuestionAnswer({ field: dateField, rawValue: '2026-09-11', answers: {} })
    expect(result).toEqual({ ok: true, answers: { txn_date: '2026-09-11' } })
  })
  it('applyQuestionAnswer: a genuinely invalid date reply is rejected end-to-end (normalize + validate)', () => {
    const result = applyQuestionAnswer({ field: dateField, rawValue: 'not-a-real-date', answers: {} })
    expect(result.ok).toBe(false)
  })
  it('applyQuestionAnswer: an impossible DD/MM/YYYY date (32/13/2026) is rejected after normalization', () => {
    const result = applyQuestionAnswer({ field: dateField, rawValue: '32/13/2026', answers: {} })
    expect(result.ok).toBe(false)
  })
})

describe('Subject/Description semantic-role auto-fill (Stage 7.1 Part 3)', () => {
  const subjectField = field({ id: 'subj', type: 'text', label: 'Subject', required: true, semantic_role: 'request_title' })
  const descField = field({ id: 'desc', type: 'textarea', label: 'Description', required: true, semantic_role: 'request_description' })
  const ordinaryField = field({ id: 'other', type: 'textarea', label: 'Business Justification', required: true })
  const hiddenSubjectField = field({ id: 'hidden_subj', type: 'text', label: 'Internal Subject', required: true, semantic_role: 'request_title', requester_can_view: false })

  it('auto-fills a request_title-mapped field from the generated title, and never asks it (alreadyAnswered)', () => {
    const result = applySemanticRoleAutofill([subjectField], {}, { title: 'Printer Not Working', description: null })
    expect(result).toEqual({ subj: 'Printer Not Working' })
  })

  it('auto-fills a request_description-mapped field from the captured description', () => {
    const result = applySemanticRoleAutofill([descField], {}, { title: null, description: 'The printer is jammed.' })
    expect(result).toEqual({ desc: 'The printer is jammed.' })
  })

  it('auto-fills BOTH mapped fields together, consistent with requests.title/requests.description', () => {
    const result = applySemanticRoleAutofill([subjectField, descField], {}, { title: 'Printer Not Working', description: 'The printer is jammed.' })
    expect(result).toEqual({ subj: 'Printer Not Working', desc: 'The printer is jammed.' })
  })

  it('an ORDINARY text/textarea field (no semantic_role) is NEVER auto-filled — still asked normally', () => {
    const result = applySemanticRoleAutofill([ordinaryField], {}, { title: 'X', description: 'Y' })
    expect(result).toEqual({}) // untouched — ordinaryField.id never appears
  })

  it('never overwrites an already-answered mapped field (resume/idempotency safety)', () => {
    const result = applySemanticRoleAutofill([subjectField], { subj: 'A requester-typed subject, answered earlier' }, { title: 'Different generated title', description: null })
    expect(result).toEqual({ subj: 'A requester-typed subject, answered earlier' })
  })

  it('a technician-only field (requester_can_view=false) is never auto-filled even if mapped', () => {
    const result = applySemanticRoleAutofill([hiddenSubjectField], {}, { title: 'Printer Not Working', description: null })
    expect(result).toEqual({})
  })

  it('returns the SAME object reference when nothing changes (no unnecessary re-render/re-commit)', () => {
    const answers = { subj: 'Already answered' }
    const result = applySemanticRoleAutofill([subjectField], answers, { title: 'X', description: null })
    expect(result).toBe(answers)
  })
})

describe('WhatsApp source_channel (Stage 7.1 Part 4)', () => {
  it('a WhatsApp-created request (created_via=whatsapp) reports source_channel=whatsapp', () => {
    expect(sourceChannelOf({ created_via: 'whatsapp' })).toBe('whatsapp')
  })
  it('a web-created request (no created_via) still reports source_channel=portal — unchanged', () => {
    expect(sourceChannelOf(null)).toBe('portal')
    expect(sourceChannelOf({})).toBe('portal')
  })
  it('an intake-sourced request still reports source_channel=intake — unchanged', () => {
    expect(sourceChannelOf({ created_via: 'intake' })).toBe('intake')
  })
})
