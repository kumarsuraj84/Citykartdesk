/** Stage 3, Steps 8-10 — form resolution (reusing resolveServiceFormSections,
 *  no second schema interpreter) and the requester-mandatory question plan.
 *  Pure, no DB.
 *
 *  Stage 3.1: findDescriptionField()/applyDescriptionToAnswers() were
 *  removed — the conversational description no longer auto-satisfies any
 *  dynamic textarea field (see "Description never satisfies an arbitrary
 *  textarea field" below, STAGE_3_1_REPORT.md's Tests 1/2). */
import { describe, it, expect } from 'vitest'
import type { FormField } from '@/types'
import { resolveDraftFormFields, buildQuestionPlan, getNextQuestion } from '@/lib/requests/questionnaire/question-plan'

function field(overrides: Partial<FormField> & Pick<FormField, 'id' | 'type' | 'label'>): FormField {
  return { required: false, order: 0, ...overrides }
}

function serviceWith(fields: FormField[]) {
  return { form_sections: [{ id: 's1', title: 'Section', order: 0, fields }] }
}

describe('resolveDraftFormFields()', () => {
  it('resolves fields from form_sections in order', () => {
    const svc = serviceWith([
      field({ id: 'b', type: 'text', label: 'B', order: 1 }),
      field({ id: 'a', type: 'text', label: 'A', order: 0 }),
    ])
    const fields = resolveDraftFormFields(svc)
    expect(fields.map((f) => f.id)).toEqual(['a', 'b'])
  })

  it('prefers a tagged template over the service\'s own sections', () => {
    const svc = {
      form_sections: [{ id: 's1', title: 'Own', order: 0, fields: [field({ id: 'own', type: 'text', label: 'Own' })] }],
      template: { form_sections: [{ id: 't1', title: 'Template', order: 0, fields: [field({ id: 'templ', type: 'text', label: 'Templ' })] }] },
    }
    const fields = resolveDraftFormFields(svc)
    expect(fields.map((f) => f.id)).toEqual(['templ'])
  })
})

describe('Stage 3.1 — description never satisfies an arbitrary textarea field', () => {
  it('TEST 1: a single mandatory textarea remains unanswered regardless of draft.description', () => {
    // draft.description ("Printer is not working.") is never consulted by
    // buildQuestionPlan()/getNextQuestion() at all — only `answers` is.
    const fields = [field({ id: 'biz_justification', type: 'textarea', label: 'Business Justification', required: true })]
    const plan = buildQuestionPlan(fields, {})
    expect(plan).toEqual([{ field: fields[0], alreadyAnswered: false }])
    expect(getNextQuestion(fields, {})?.id).toBe('biz_justification')
  })

  it('TEST 2: multiple mandatory textareas all remain unanswered until explicitly supplied through answers', () => {
    const fields = [
      field({ id: 'business_impact', type: 'textarea', label: 'Business Impact', required: true, order: 0 }),
      field({ id: 'troubleshooting', type: 'textarea', label: 'Troubleshooting', required: true, order: 1 }),
    ]
    // No `answers` supplied at all — a rich draft.description exists
    // elsewhere in a real draft, but this function never sees or needs it.
    const plan = buildQuestionPlan(fields, {})
    expect(plan.every((p) => !p.alreadyAnswered)).toBe(true)
    expect(getNextQuestion(fields, {})?.id).toBe('business_impact')

    const afterFirstAnswer = getNextQuestion(fields, { business_impact: 'Billing halted' })
    expect(afterFirstAnswer?.id).toBe('troubleshooting')
  })
})

describe('buildQuestionPlan() / getNextQuestion()', () => {
  const fields = [
    field({ id: 'subject', type: 'text', label: 'Subject', required: true, order: 0 }),
    field({ id: 'issue', type: 'select', label: 'Issue Type', required: true, order: 1, options: [{ value: 'a', label: 'A' }] }),
    field({ id: 'notes', type: 'textarea', label: 'Notes', required: false, order: 2 }),
    field({ id: 'addr', type: 'store_address', label: 'Store Address', required: true, order: 3 }),
    field({ id: 'tech', type: 'text', label: 'Tech Only', required: true, order: 4, requester_can_view: false }),
    field({ id: 'photo', type: 'file', label: 'Photo', required: true, order: 5 }),
  ]

  it('excludes store_address and technician-only fields, excludes optional fields', () => {
    const plan = buildQuestionPlan(fields, {})
    const ids = plan.map((p) => p.field.id)
    expect(ids).not.toContain('addr')
    expect(ids).not.toContain('tech')
    expect(ids).not.toContain('notes')
  })

  it('includes a mandatory file field (surfaced, not silently skipped)', () => {
    const plan = buildQuestionPlan(fields, {})
    expect(plan.map((p) => p.field.id)).toContain('photo')
  })

  it('flags alreadyAnswered based on answers', () => {
    const plan = buildQuestionPlan(fields, { subject: 'AC issue' })
    const subjectItem = plan.find((p) => p.field.id === 'subject')
    expect(subjectItem?.alreadyAnswered).toBe(true)
    const issueItem = plan.find((p) => p.field.id === 'issue')
    expect(issueItem?.alreadyAnswered).toBe(false)
  })

  it('getNextQuestion returns the first unanswered mandatory field in order', () => {
    expect(getNextQuestion(fields, {})?.id).toBe('subject')
    expect(getNextQuestion(fields, { subject: 'x' })?.id).toBe('issue')
    expect(getNextQuestion(fields, { subject: 'x', issue: 'a' })?.id).toBe('photo')
  })

  it('getNextQuestion returns null once every mandatory field is answered', () => {
    expect(getNextQuestion(fields, { subject: 'x', issue: 'a', photo: 'anything' })).toBeNull()
  })
})
