'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, RotateCcw, Star } from 'lucide-react'
import { submitRatingByToken, reopenByToken } from '@/lib/actions/csatPublic'

const LABELS = ['', 'Terrible', 'Poor', 'OK', 'Good', 'Excellent']
const LOW = 2

interface Props {
  token: string
  startRating: number
  startReopen: boolean
  rated: boolean
  ratedValue: number | null
  canReopen: boolean
  reopenUntilIso: string | null
  reopenEnded: boolean
}

const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })

export function CsatPublicForm(p: Props) {
  const [rating, setRating] = useState(p.startRating)
  const [comment, setComment] = useState('')
  const [rated, setRated] = useState(p.rated)
  const [reopening, setReopening] = useState(p.startReopen)
  const [reason, setReason] = useState('')
  const [reopened, setReopened] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (reopened) {
    return (
      <div className="space-y-2 text-center" role="status">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50"><RotateCcw className="h-6 w-6 text-emerald-600" /></div>
        <h2 className="text-lg font-semibold">Request reopened</h2>
        <p className="text-sm text-muted-foreground">We have told the team and they will pick it up again. You will get an update by e-mail.</p>
      </div>
    )
  }

  const submitRating = () => {
    if (!rating) { setError('Please choose a rating.'); return }
    if (rating <= LOW && !comment.trim()) { setError('Please tell us briefly what went wrong, so we can put it right.'); return }
    setError(null)
    start(async () => {
      const res = await submitRatingByToken(p.token, rating, comment)
      if (res.error) setError(res.error)
      else setRated(true)
    })
  }

  const submitReopen = () => {
    if (!reason.trim()) { setError('Please tell us why you are reopening this request.'); return }
    setError(null)
    start(async () => {
      const res = await reopenByToken(p.token, reason)
      if (res.error) setError(res.error)
      else setReopened(true)
    })
  }

  return (
    <div className="space-y-5">
      {rated ? (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-center space-y-1" role="status">
          <div className="flex justify-center gap-0.5">
            {[1, 2, 3, 4, 5].map((s) => <Star key={s} className={`h-4 w-4 ${s <= (rating || p.ratedValue || 0) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} />)}
          </div>
          <p className="flex items-center justify-center gap-1.5 text-sm text-foreground"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Thank you for your feedback</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-medium">How satisfied were you with how this was handled?</p>
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((s) => (
              <button key={s} type="button" onClick={() => setRating(s)} aria-label={`${s} star${s > 1 ? 's' : ''}`} aria-pressed={rating === s} className="transition-transform hover:scale-110">
                <Star className={`h-8 w-8 ${s <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30 hover:text-amber-300'}`} />
              </button>
            ))}
            {rating > 0 && <span className="ml-2 text-sm text-muted-foreground">{LABELS[rating]}</span>}
          </div>
          {rating > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="csat-comment" className="text-xs font-medium text-muted-foreground">
                {rating <= LOW ? 'What went wrong? (required)' : 'Anything you would like to add? (optional)'}
              </label>
              <textarea id="csat-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
          )}
          <button type="button" onClick={submitRating} disabled={pending || !rating}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {pending && !reopening ? 'Sending…' : 'Submit rating'}
          </button>
        </div>
      )}

      {p.canReopen && (
        <div className="border-t border-border pt-4 space-y-3">
          {!reopening ? (
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">Not fixed yet?{p.reopenUntilIso ? ` You can reopen this until ${fmt(p.reopenUntilIso)}.` : ''}</p>
              <button type="button" onClick={() => { setReopening(true); setError(null) }} className="text-sm font-semibold text-primary hover:underline">Reopen this request</button>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="csat-reason" className="text-sm font-medium">Why are you reopening this? (required)</label>
              <textarea id="csat-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} autoFocus
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
              <div className="flex gap-2">
                <button type="button" onClick={submitReopen} disabled={pending} className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                  {pending ? 'Reopening…' : 'Reopen request'}
                </button>
                <button type="button" onClick={() => { setReopening(false); setError(null) }} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
      {p.reopenEnded && !rated && <p className="text-xs text-muted-foreground">The reopen window for this request has ended. If something is still wrong, please raise a new request.</p>}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
