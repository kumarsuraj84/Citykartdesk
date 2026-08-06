'use client'

import { useState } from 'react'
import { X, FlaskConical } from 'lucide-react'

export function DemoBanner() {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  return (
    <div className="relative z-50 flex items-center justify-center gap-3 bg-gradient-to-r from-amber-500/90 to-orange-500/90 px-4 py-2 text-white text-sm font-medium">
      <FlaskConical className="h-4 w-4 flex-shrink-0" />
      <span>
        Live Demo — sample data only. Changes are not saved.
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="ml-2 grid h-5 w-5 place-items-center rounded-full hover:bg-white/20 transition-colors"
        aria-label="Dismiss demo banner"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
