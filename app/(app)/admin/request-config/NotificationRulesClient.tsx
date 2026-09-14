'use client'

import { useState, useTransition } from 'react'
import { Mail, Bell, Smartphone, Check } from 'lucide-react'
import { saveNotificationRules, type NotificationRuleValues } from '@/lib/actions/admin/notificationRules'
import { NOTIFICATION_RULE_GROUPS } from '@/lib/constants/notification-rules'

type Channel = 'email' | 'in_app' | 'push'

function HeaderIcon({ channel }: { channel: Channel }) {
  if (channel === 'email') return <Mail className="h-3.5 w-3.5" />
  if (channel === 'in_app') return <Bell className="h-3.5 w-3.5" />
  return <Smartphone className="h-3.5 w-3.5" />
}

const CHANNEL_LABELS: Record<Channel, string> = { email: 'Email', in_app: 'Portal', push: 'Push' }

export function NotificationRulesClient({
  initialRules,
  pushConfigured,
  reopenWindowDays,
}: {
  initialRules: NotificationRuleValues[]
  pushConfigured: boolean
  /** Live value of the admin-configurable reopen window (Request Configuration → General) —
   *  filled into the request_auto_closed row's hint so it can never drift out of sync with reality. */
  reopenWindowDays: number
}) {
  const [rules, setRules] = useState<Map<string, NotificationRuleValues>>(
    new Map(initialRules.map((r) => [r.event_type, r]))
  )
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle(eventType: string, channel: Channel) {
    setRules((prev) => {
      const next = new Map(prev)
      const current = next.get(eventType)
      if (!current) return prev
      next.set(eventType, { ...current, [channel]: !current[channel] })
      return next
    })
    setDirty(true)
    setSaved(false)
  }

  function toggleColumn(channel: Channel, turnOn: boolean) {
    let changed = false
    setRules((prev) => {
      const next = new Map(prev)
      for (const [k, v] of next) {
        if (v[channel] !== turnOn) changed = true
        next.set(k, { ...v, [channel]: turnOn })
      }
      return next
    })
    // Only flag dirty/clear "Saved" if this actually flipped something —
    // clicking "all on" when everything's already on shouldn't falsely
    // enable Save or claim there are unsaved changes.
    if (changed) {
      setDirty(true)
      setSaved(false)
    }
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const result = await saveNotificationRules([...rules.values()])
      if (result.error) {
        setError(result.error)
        return
      }
      setDirty(false)
      setSaved(true)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-3">
          {(['email', 'in_app', 'push'] as Channel[]).map((c) => (
            <div key={c} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground inline-flex items-center gap-1">
                <HeaderIcon channel={c} /> {CHANNEL_LABELS[c]}
              </span>
              <button
                type="button"
                onClick={() => toggleColumn(c, true)}
                className="rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
              >
                all on
              </button>
              <span className="text-border">/</span>
              <button
                type="button"
                onClick={() => toggleColumn(c, false)}
                className="rounded px-1.5 py-0.5 hover:bg-muted transition-colors"
              >
                all off
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {saved && !dirty && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          {error && <span className="text-xs text-red-600">{error}</span>}
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || pending}
            className="btn-gradient disabled:opacity-40"
          >
            {pending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {!pushConfigured && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Push isn&apos;t set up yet (no VAPID key configured) — the Push column has no effect until it is. Toggling it here is safe; it&apos;ll just start working once push is enabled.
        </p>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[1fr_70px_70px_70px] items-center gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Event</span>
          {(['email', 'in_app', 'push'] as Channel[]).map((c) => (
            <span key={c} className="flex justify-center text-muted-foreground" title={CHANNEL_LABELS[c]}>
              <HeaderIcon channel={c} />
            </span>
          ))}
        </div>

        {NOTIFICATION_RULE_GROUPS.map((group) => (
          <div key={group.label}>
            <div className="bg-muted/15 px-4 py-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{group.label}</span>
            </div>
            {group.rows.map((row) => {
              const rule = rules.get(row.type)
              if (!rule) return null
              return (
                <div
                  key={row.type}
                  className="grid grid-cols-[1fr_70px_70px_70px] items-center gap-2 border-b border-border/50 last:border-0 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{row.label}</p>
                    {row.hint && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        {row.hint}
                        {row.type === 'request_auto_closed' && (
                          <> — currently {reopenWindowDays} day{reopenWindowDays === 1 ? '' : 's'} ({reopenWindowDays * 24}h), see General tab</>
                        )}
                      </p>
                    )}
                  </div>
                  {(['email', 'in_app', 'push'] as Channel[]).map((c) => (
                    <div key={c} className="flex justify-center">
                      <input
                        type="checkbox"
                        checked={rule[c]}
                        onChange={() => toggle(row.type, c)}
                        className="h-4 w-4 rounded accent-primary cursor-pointer"
                        aria-label={`${CHANNEL_LABELS[c]} for ${row.label}`}
                      />
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
