'use client'

import { useState, useTransition } from 'react'
import { setHealthCheckEnabled } from '@/lib/actions/health'

/** On / off switch per check. Switching a check off stops measuring it, closes its open outage and hides it from the page (the history stays). */
export function CheckToggles({ items }: { items: { key: string; label: string; enabled: boolean; locked?: boolean }[] }) {
  const [state, setState] = useState(() => Object.fromEntries(items.map((i) => [i.key, i.enabled])))
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <div>
      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((i) => (
          <li key={i.key} className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
            <span className="truncate text-foreground" title={i.label}>{i.label}</span>
            <label className="flex shrink-0 items-center gap-1.5">
              <input
                type="checkbox"
                checked={!!state[i.key]}
                disabled={pending || i.locked}
                onChange={(e) => {
                  const next = e.target.checked
                  setError(null)
                  setState((s) => ({ ...s, [i.key]: next }))
                  start(async () => {
                    const r = await setHealthCheckEnabled(i.key, next)
                    if (r.error) { setError(r.error); setState((s) => ({ ...s, [i.key]: !next })) }
                  })
                }}
              />
              <span className="text-muted-foreground">{state[i.key] ? 'On' : 'Off'}</span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
