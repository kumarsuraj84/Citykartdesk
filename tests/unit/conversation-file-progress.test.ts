/** Stage 4, Step 22 — file-field-aware progress reconciliation. Pure, no DB
 *  (attachments are passed in as plain objects, not fetched). */
import { describe, it, expect } from 'vitest'
import { buildLogicalAnswers, reconcileReviewForAttachments } from '@/lib/conversations/file-progress'
import type { ConversationAttachment } from '@/lib/conversations/repository'
import type { RequestReviewModel } from '@/lib/requests/questionnaire/types'
import type { FormField } from '@/types'

// Stage 5.1 (Part 3) default is 'staged' — a bare 'received_reference' no
// longer satisfies a mandatory file field (see the dedicated describe
// block below); most of this file's existing tests are about the
// mechanics of reconciliation once an attachment IS satisfying, so they
// default to the satisfying status and override where they specifically
// want to test a non-satisfying one.
function attachment(overrides: Partial<ConversationAttachment> & Pick<ConversationAttachment, 'fieldId'>): ConversationAttachment {
  return {
    id: 'att-1', conversationId: 'conv-1', externalMediaId: null, fileName: null, mimeType: null, size: null,
    status: 'staged', storagePath: null, stagedMimeType: null, stagedSize: null, lastError: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('buildLogicalAnswers()', () => {
  it('leaves answers unchanged when there are no attachments', () => {
    const answers = { a: '1' }
    expect(buildLogicalAnswers(answers, [])).toEqual({ a: '1' })
  })

  it('adds a truthy placeholder for a field with a STAGED attachment', () => {
    const answers = { a: '1' }
    const result = buildLogicalAnswers(answers, [attachment({ fieldId: 'photo', status: 'staged' })])
    expect(result).toEqual({ a: '1', photo: true })
  })

  it('adds a truthy placeholder for a field with a LINKED attachment (already promoted, post-Create)', () => {
    const answers = { a: '1' }
    const result = buildLogicalAnswers(answers, [attachment({ fieldId: 'photo', status: 'linked' })])
    expect(result).toEqual({ a: '1', photo: true })
  })

  // Stage 5.1 (Part 3) — the exact gap this stage closed: Stage 5 originally
  // let ANY attachment row, regardless of status, satisfy a mandatory file
  // field. A bare reference (media id received, never downloaded/
  // validated) or a genuinely failed one must NEVER be treated as answered.
  it.each(['received_reference', 'failed'] as const)('does NOT satisfy a field whose only attachment has status "%s"', (status) => {
    const answers = { a: '1' }
    const result = buildLogicalAnswers(answers, [attachment({ fieldId: 'photo', status })])
    expect(result).toEqual({ a: '1' }) // no `photo` placeholder added
  })

  it('does not overwrite an already-present real answer for that field id', () => {
    const answers = { photo: 'real-value' }
    const result = buildLogicalAnswers(answers, [attachment({ fieldId: 'photo' })])
    expect(result.photo).toBe('real-value')
  })

  it('does not mutate the input answers object', () => {
    const answers = { a: '1' }
    buildLogicalAnswers(answers, [attachment({ fieldId: 'photo' })])
    expect(answers).toEqual({ a: '1' })
  })

  it('never appears in a form intended for createRequestCore() — logical answers are a separate object', () => {
    const answers: Record<string, unknown> = { a: '1' }
    const logical = buildLogicalAnswers(answers, [attachment({ fieldId: 'photo' })])
    expect(answers.photo).toBeUndefined()
    expect(logical).not.toBe(answers)
  })
})

describe('reconcileReviewForAttachments()', () => {
  const photoField: FormField = { id: 'photo', type: 'file', label: 'Photo', required: true, order: 0 }

  function baseReview(overrides: Partial<RequestReviewModel> = {}): RequestReviewModel {
    return {
      serviceId: 'svc-1', serviceName: 'IT', subCategoryId: null, subCategoryName: null, categoryId: null,
      description: 'desc', title: 'title', fields: [], ready: false,
      missingFields: [{ key: 'photo', label: 'Photo' }], invalidFields: [],
      ...overrides,
    }
  }

  it('removes a missing file field once a real attachment exists, and flips ready to true', () => {
    const review = baseReview()
    const reconciled = reconcileReviewForAttachments(review, [photoField], [attachment({ fieldId: 'photo' })])
    expect(reconciled.missingFields).toEqual([])
    expect(reconciled.ready).toBe(true)
  })

  it('leaves a missing file field missing when no attachment exists', () => {
    const review = baseReview()
    const reconciled = reconcileReviewForAttachments(review, [photoField], [])
    expect(reconciled.missingFields).toEqual([{ key: 'photo', label: 'Photo' }])
    expect(reconciled.ready).toBe(false)
  })

  it.each(['received_reference', 'failed'] as const)(
    'leaves the field missing/not-ready when its only attachment has status "%s" — a media id alone is never enough',
    (status) => {
      const review = baseReview()
      const reconciled = reconcileReviewForAttachments(review, [photoField], [attachment({ fieldId: 'photo', status })])
      expect(reconciled.missingFields).toEqual([{ key: 'photo', label: 'Photo' }])
      expect(reconciled.ready).toBe(false)
    }
  )

  it('does not touch missing NON-file fields, even with unrelated attachments present', () => {
    const review = baseReview({ missingFields: [{ key: 'subject', label: 'Subject' }] })
    const reconciled = reconcileReviewForAttachments(review, [photoField], [attachment({ fieldId: 'photo' })])
    expect(reconciled.missingFields).toEqual([{ key: 'subject', label: 'Subject' }])
    expect(reconciled.ready).toBe(false)
  })

  it('stays not-ready if invalidFields are non-empty even when all missing file fields are satisfied', () => {
    const review = baseReview({ invalidFields: [{ key: 'x', label: 'X', message: 'bad' }] })
    const reconciled = reconcileReviewForAttachments(review, [photoField], [attachment({ fieldId: 'photo' })])
    expect(reconciled.ready).toBe(false)
  })

  it('is a no-op when there are no attachments at all', () => {
    const review = baseReview()
    const reconciled = reconcileReviewForAttachments(review, [photoField], [])
    expect(reconciled).toEqual(review)
  })
})
