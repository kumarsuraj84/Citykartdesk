'use client'

import { useEffect, useState } from 'react'
import { Sparkles, ChevronDown } from 'lucide-react'
import { generateEmailBrief } from '@/lib/actions/intake/brief'

interface AiBriefProps {
  subject: string | null
  bodyText: string | null
  fromAddress: string | null
}

// Turn the server action's error code into a short human reason. Returning null
// means "hide silently" (nothing worth summarizing); a string is shown muted so
// admins can see WHY the brief is absent instead of it vanishing with no clue.
function reasonFor(error?: string): string | null {
  if (!error) return null // no error + no brief = empty email, hide silently
  if (error === 'not_configured') return 'AI summary not configured (set INTAKE_LLM_API_KEY in Vercel).'
  if (error.startsWith('api_401') || error.startsWith('api_403')) return 'AI key rejected by provider (check INTAKE_LLM_API_KEY).'
  if (error.startsWith('api_429')) return 'AI provider rate-limited — try again shortly.'
  if (error.startsWith('api_')) return `AI provider error (${error.slice(0, 40)}).`
  if (error === 'timeout_or_network') return 'AI summary timed out — provider unreachable.'
  return 'AI summary unavailable.'
}

export function AiBrief({ subject, bodyText, fromAddress }: AiBriefProps) {
  const [brief, setBrief]         = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [collapsed, setCollapsed] = useState(false)
  const [hidden, setHidden]       = useState(false)
  const [reason, setReason]       = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setBrief(null)
    setHidden(false)
    setReason(null)

    generateEmailBrief(subject, bodyText, fromAddress).then((r) => {
      if (cancelled) return
      if (r.brief) {
        setBrief(r.brief)
      } else {
        const why = reasonFor(r.error)
        // Only hide completely when there's nothing to explain (empty email).
        if (why) setReason(why)
        else setHidden(true)
      }
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [subject, bodyText, fromAddress])

  if (hidden) return null

  // Show a muted diagnostic line when the summary failed, so the absence is
  // explained rather than silent. Replaces the gradient card with a quiet note.
  if (!loading && !brief && reason) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-amber-200/60 bg-amber-50/40 px-4 py-2 text-[11px] text-amber-700">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span>{reason}</span>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-indigo-200/70 bg-gradient-to-r from-indigo-50/90 via-violet-50/60 to-fuchsia-50/30">
      {/* Header row */}
      <button
        type="button"
        onClick={() => !loading && setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <Sparkles className={`h-3.5 w-3.5 shrink-0 text-indigo-500 ${loading ? 'animate-pulse' : ''}`} />
        <span className="flex-1 text-[11px] font-bold uppercase tracking-wider text-indigo-700">
          AI Summary
        </span>
        {!loading && (
          <ChevronDown
            className={`h-3.5 w-3.5 text-indigo-400 transition-transform duration-200 ${
              collapsed ? '-rotate-90' : ''
            }`}
          />
        )}
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="px-4 pb-3.5">
          {loading ? (
            /* Typing dots */
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:120ms]" />
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:240ms]" />
              <span className="ml-1 text-[11px] text-indigo-400">Summarizing…</span>
            </div>
          ) : (
            <p className="text-[13px] leading-relaxed text-foreground/90">{brief}</p>
          )}
        </div>
      )}
    </div>
  )
}
