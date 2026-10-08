'use client'

import { useState, useTransition } from 'react'
import { Save, Check, AlertTriangle } from 'lucide-react'
import { updateAppSetting } from '@/lib/actions/admin/config'

interface Props {
  enabled: boolean
  reminderDays: number
}

export function CsatSettingsClient({ enabled: initialEnabled, reminderDays: initialDays }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [days, setDays] = useState(String(initialDays))
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const dirty = enabled !== initialEnabled || days !== String(initialDays)

  function save() {
    const parsed = parseInt(days, 10)
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 30) { setError('Reminder days must be a number from 0 to 30 (0 = no reminder).'); return }
    setError(null)
    start(async () => {
      const a = await updateAppSetting('csat_enabled', enabled ? 'true' : 'false')
      if (a.error) { setError(a.error); return }
      const b = await updateAppSetting('csat_reminder_days', String(parsed))
      if (b.error) { setError(b.error); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="px-4 py-3 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">Ask for a rating when a request is resolved</p>
            <p className="text-xs text-muted-foreground">
              The requester gets one e-mail when their request is resolved: what was done, a 1–5 star rating and a link to reopen it
              (with a reason). When this is off, they get the plain &quot;resolved&quot; e-mail instead. Closing a request never sends an e-mail.
            </p>
          </div>
          <label className="flex items-center gap-2 shrink-0 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
            {enabled ? 'On' : 'Off'}
          </label>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">Reminder after (days)</p>
            <p className="text-xs text-muted-foreground">
              One reminder is sent this many days after resolving to a requester who has not rated or reopened. 0 sends no reminder.
              Ratings of 1 or 2 stars alert the technician and the group leads.
            </p>
          </div>
          <input
            type="number" min="0" max="30" value={days} disabled={!enabled}
            onChange={(e) => setDays(e.target.value)}
            className="w-20 shrink-0 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
        </div>

        <div className="flex items-center justify-end gap-3">
          {saved && <Check className="h-4 w-4 text-emerald-500" />}
          <button onClick={save} disabled={pending || !dirty} className="btn-gradient disabled:opacity-50">
            <Save className="h-3.5 w-3.5" />
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
