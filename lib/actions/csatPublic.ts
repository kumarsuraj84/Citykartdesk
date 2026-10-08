'use server'

// The two things the requester can do from the link in the resolved e-mail, without logging in. The signed token proves
// which survey (and so which ticket and requester) the link belongs to; nothing else is trusted from the browser.

import { createAdminClient } from '@/lib/supabase/admin'
import { applyStatusChange } from '@/lib/requests/status-change'
import { notifyLowRating, LOW_CSAT_MAX } from '@/lib/csat/alerts'
import { loadCsatPage } from '@/lib/csat/public'
import type { ProfileWithTeams } from '@/types'

type Result = { error?: string }

export async function submitRatingByToken(token: string, rating: number, comment: string): Promise<Result> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: 'Please choose a rating from 1 to 5.' }
  const text = (comment ?? '').trim().slice(0, 2000)
  if (rating <= LOW_CSAT_MAX && !text) return { error: 'Please tell us briefly what went wrong, so we can put it right.' }

  const state = await loadCsatPage(token)
  if (state.kind === 'invalid') return { error: 'This link is not valid.' }
  if (state.kind === 'expired') return { error: 'This link has expired.' }
  if (state.reopened) return { error: 'This request is being worked on again, so it cannot be rated right now.' }
  if (state.rated) return { error: 'This request has already been rated. Thank you!' }

  const admin = createAdminClient()
  const { data: saved, error } = await admin
    .from('csat_surveys')
    .update({ rating, comment: text || null, submitted_at: new Date().toISOString() })
    .eq('id', state.surveyId)
    .is('submitted_at', null)
    .select('requester_id')
    .maybeSingle()
  if (error) return { error: 'Could not save your rating. Please try again.' }
  if (!saved) return { error: 'This request has already been rated. Thank you!' }

  await notifyLowRating(admin, { requestId: state.requestId, rating, comment: text, requesterId: saved.requester_id })
  return {}
}

export async function reopenByToken(token: string, reason: string): Promise<Result> {
  const text = (reason ?? '').trim().slice(0, 2000)
  if (!text) return { error: 'Please tell us why you are reopening this request.' }

  const state = await loadCsatPage(token)
  if (state.kind === 'invalid') return { error: 'This link is not valid.' }
  if (state.kind === 'expired') return { error: 'This link has expired.' }
  if (state.reopened) return { error: 'This request is already open again.' }
  if (!state.canReopen) return { error: 'The reopen window for this request has ended.' }

  const admin = createAdminClient()
  const { data: survey } = await admin.from('csat_surveys').select('requester_id').eq('id', state.surveyId).maybeSingle()
  if (!survey) return { error: 'This link is not valid.' }
  const { data: requester } = await admin
    .from('profiles')
    .select('*, team_members(team_id, is_lead, joined_at, team:teams(*))')
    .eq('id', survey.requester_id)
    .maybeSingle()
  if (!requester) return { error: 'Could not find the requester for this request.' }

  // Same rules as reopening from inside the app: the window, the mandatory reason, the SLA restart and the notifications.
  const res = await applyStatusChange({ supabase: admin as never, profile: requester as unknown as ProfileWithTeams }, state.requestId, 'open', text)
  return res.error ? { error: res.error } : {}
}
