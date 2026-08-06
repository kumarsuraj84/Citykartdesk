'use client'

import { useState, useTransition } from 'react'
import { Save, Check, AlertTriangle } from 'lucide-react'
import { updateAppSetting } from '@/lib/actions/admin/config'

interface AppSettingsClientProps {
  autoCloseDays: number
}

export function AppSettingsClient({ autoCloseDays }: AppSettingsClientProps) {
  const [value, setValue]         = useState(String(autoCloseDays))
  const [editing, setEditing]     = useState(false)
  const [saved, setSaved]         = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    const parsed = parseInt(value, 10)
    if (isNaN(parsed) || parsed < 1) {
      setError('Must be a positive integer.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await updateAppSetting('auto_close_days', String(parsed))
      if (result.error) { setError(result.error); return }
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
      <div className="border-b border-border/50 px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">Auto-close after resolution (days)</p>
            <p className="text-xs text-muted-foreground">
              Resolved requests are automatically closed after this many days with no activity.
            </p>
          </div>
          {editing ? (
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="number"
                min="1"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-20 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={handleSave}
                disabled={isPending}
                className="btn-gradient"
              >
                <Save className="h-3.5 w-3.5" />
                {isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(false); setValue(String(autoCloseDays)); setError(null) }}
                className="btn-soft"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 shrink-0">
              {saved && <Check className="h-4 w-4 text-emerald-500" />}
              <span className="text-sm font-semibold tabular-nums text-foreground">{value}d</span>
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-primary hover:underline"
              >
                Edit
              </button>
            </div>
          )}
        </div>
        {error && (
          <div className="mt-2 flex items-center gap-2 text-xs text-red-600">
            <AlertTriangle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
