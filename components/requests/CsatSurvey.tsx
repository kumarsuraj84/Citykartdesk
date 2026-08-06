'use client'

import { useState, useTransition } from 'react'
import { Star } from 'lucide-react'
import { submitCsatRating } from '@/lib/actions/requests'

const LABELS = ['', 'Terrible', 'Poor', 'OK', 'Good', 'Excellent']

interface CsatSurveyProps {
  surveyId: string
  initialRating: number | null
  initialComment: string | null
  submitted: boolean
}

export function CsatSurvey({ surveyId, initialRating, initialComment, submitted: initialSubmitted }: CsatSurveyProps) {
  const [rating, setRating]       = useState<number>(initialRating ?? 0)
  const [hovered, setHovered]     = useState<number>(0)
  const [comment, setComment]     = useState(initialComment ?? '')
  const [submitted, setSubmitted] = useState(initialSubmitted)
  const [error, setError]         = useState<string | null>(null)
  const [isPending, start]        = useTransition()

  if (submitted) {
    return (
      <div className="rounded-xl border border-border bg-card px-5 py-4 text-center space-y-1">
        <div className="flex justify-center gap-0.5">
          {[1,2,3,4,5].map((s) => (
            <Star
              key={s}
              className={`h-4 w-4 ${s <= (initialRating ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Thank you for your feedback!</p>
      </div>
    )
  }

  function handleSubmit() {
    if (!rating) { setError('Please select a rating.'); return }
    setError(null)
    start(async () => {
      const res = await submitCsatRating(surveyId, rating, comment)
      if (res?.error) { setError(res.error); return }
      setSubmitted(true)
    })
  }

  const display = hovered || rating

  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4 space-y-3">
      <p className="text-xs font-semibold text-foreground">How satisfied were you with our support?</p>

      {/* Star picker */}
      <div className="flex items-center gap-1.5">
        {[1,2,3,4,5].map((s) => (
          <button
            key={s}
            onClick={() => setRating(s)}
            onMouseEnter={() => setHovered(s)}
            onMouseLeave={() => setHovered(0)}
            className="transition-transform hover:scale-110"
          >
            <Star
              className={`h-6 w-6 transition-colors ${
                s <= display
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-muted-foreground/30 hover:text-amber-300'
              }`}
            />
          </button>
        ))}
        {display > 0 && (
          <span className="ml-1 text-xs text-muted-foreground">{LABELS[display]}</span>
        )}
      </div>

      {/* Comment */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Any additional feedback? (optional)"
        rows={2}
        className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={isPending}
        className="btn-gradient"
      >
        {isPending ? 'Submitting…' : 'Submit feedback'}
      </button>
    </div>
  )
}
