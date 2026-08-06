'use client'

import { X } from 'lucide-react'
import { useState } from 'react'

interface TrialBannerProps {
  daysLeft: number
}

export function TrialBanner({ daysLeft }: TrialBannerProps) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const urgent = daysLeft <= 3

  return (
    <div
      className={`relative flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium ${
        urgent
          ? 'bg-destructive text-destructive-foreground'
          : 'bg-amber-500 text-white'
      }`}
    >
      <span>
        {daysLeft === 0
          ? 'Your free trial expires today. '
          : `Your free trial expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. `}
        <a
          href="mailto:sales@cognixdesk.app"
          className="underline underline-offset-2 hover:opacity-80"
        >
          Contact us to upgrade →
        </a>
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
