// What the e-mail link page needs to know about a survey: whether the link is good, and what the requester can still do.

import { createAdminClient } from '@/lib/supabase/admin'
import { verifyCsatToken } from './token'

export type CsatPageState =
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | {
      kind: 'ok'
      surveyId: string
      requestId: string
      requestNo: string
      title: string
      rating: number | null
      /** already rated: nothing more to ask */
      rated: boolean
      /** resolved and still inside the reopen window */
      canReopen: boolean
      /** the reopen window has ended but the ticket is resolved/closed: rating only */
      reopenEnded: boolean
      /** the ticket is open again (reopened, or being worked on): the survey is not open right now */
      reopened: boolean
      reopenUntilIso: string | null
    }

export async function loadCsatPage(token: string): Promise<CsatPageState> {
  const check = verifyCsatToken(token)
  if (!check.ok) return { kind: check.reason }

  const admin = createAdminClient()
  const { data: survey } = await admin.from('csat_surveys').select('id, request_id, rating, submitted_at').eq('id', check.surveyId).maybeSingle()
  if (!survey) return { kind: 'invalid' }
  const { data: req } = await admin.from('requests').select('id, request_no, title, status, reopen_deadline_at').eq('id', survey.request_id).maybeSingle()
  if (!req) return { kind: 'invalid' }

  const done = req.status === 'resolved' || req.status === 'closed'
  const inWindow = req.status === 'resolved' && !!req.reopen_deadline_at && new Date(req.reopen_deadline_at) > new Date()
  return {
    kind: 'ok',
    surveyId: survey.id,
    requestId: req.id,
    requestNo: req.request_no,
    title: req.title,
    rating: survey.rating,
    rated: !!survey.submitted_at,
    canReopen: inWindow,
    reopenEnded: done && !inWindow,
    reopened: !done,
    reopenUntilIso: req.reopen_deadline_at,
  }
}
