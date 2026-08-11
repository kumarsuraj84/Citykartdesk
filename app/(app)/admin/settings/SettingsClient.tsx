'use client'

import { useState, useTransition } from 'react'
import { Save, Check, AlertTriangle, Circle, Link2, Link2Off } from 'lucide-react'
import { updateAppSetting, updateRetentionPolicy } from '@/lib/actions/admin/config'
import { saveDeskTimeApiKey, disconnectDeskTime } from '@/lib/actions/admin/integrations'

type Tab = 'general' | 'retention' | 'integrations'

interface RetentionPolicy {
  id: string
  entity_type: string
  retention_days: number
  archive_after_days: number | null
  purge_after_days: number | null
  is_active: boolean
}

interface SettingsClientProps {
  autoCloseDays: number
  retentionPolicies: RetentionPolicy[]
  integrationStatus: {
    resendKeySet: boolean
    resendKeyMasked: string | null
  }
  deskTimeStatus: {
    connected: boolean
    connectedAt: string | null
  }
}

const ENTITY_LABELS: Record<string, string> = {
  request:      'Requests',
  task:         'Tasks',
  audit_log:    'Audit Logs',
  notification: 'Notifications',
  attachment:   'Attachments',
}

function NullableNumberInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
}) {
  return (
    <input
      type="number"
      min="1"
      value={value ?? ''}
      placeholder={placeholder ?? 'never'}
      onChange={(e) => {
        const raw = e.target.value
        onChange(raw === '' ? null : parseInt(raw, 10))
      }}
      className="w-24 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
    />
  )
}

function GeneralTab({ autoCloseDays }: { autoCloseDays: number }) {
  const [value, setValue]             = useState(String(autoCloseDays))
  const [editing, setEditing]         = useState(false)
  const [saved, setSaved]             = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [isPending, startTransition]  = useTransition()

  function handleSave() {
    const parsed = parseInt(value, 10)
    if (isNaN(parsed) || parsed < 1) { setError('Must be a positive integer.'); return }
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
    <div className="space-y-4 max-w-2xl">
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
                  className="btn-gradient disabled:opacity-40"
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
                <button onClick={() => setEditing(true)} className="text-xs text-primary hover:underline">
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
    </div>
  )
}

function RetentionRow({ policy }: { policy: RetentionPolicy }) {
  const [retainDays,  setRetainDays]  = useState(policy.retention_days)
  const [archiveDays, setArchiveDays] = useState<number | null>(policy.archive_after_days)
  const [purgeDays,   setPurgeDays]   = useState<number | null>(policy.purge_after_days)
  const [editing,     setEditing]     = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [isPending, startTransition]  = useTransition()

  function handleSave() {
    if (retainDays < 1) { setError('Retention days must be at least 1.'); return }
    setError(null)
    startTransition(async () => {
      const result = await updateRetentionPolicy(policy.id, {
        retention_days:     retainDays,
        archive_after_days: archiveDays,
        purge_after_days:   purgeDays,
      })
      if (result.error) { setError(result.error); return }
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })
  }

  return (
    <div className="border-b border-border/50 last:border-0 px-4 py-3">
      <div className="grid grid-cols-[160px_1fr_1fr_1fr_120px] items-center gap-3">
        <span className="text-sm font-medium text-foreground">
          {ENTITY_LABELS[policy.entity_type] ?? policy.entity_type}
        </span>

        {editing ? (
          <>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground">Retain (days)</span>
              <input
                type="number"
                min="1"
                value={retainDays}
                onChange={(e) => setRetainDays(parseInt(e.target.value, 10) || 1)}
                className="w-24 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground">Archive after</span>
              <NullableNumberInput value={archiveDays} onChange={setArchiveDays} />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-muted-foreground">Purge after</span>
              <NullableNumberInput value={purgeDays} onChange={setPurgeDays} />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={isPending}
                className="btn-gradient disabled:opacity-40"
              >
                <Save className="h-3 w-3" />
                {isPending ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setEditing(false)
                  setRetainDays(policy.retention_days)
                  setArchiveDays(policy.archive_after_days)
                  setPurgeDays(policy.purge_after_days)
                  setError(null)
                }}
                className="btn-soft"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="text-sm tabular-nums text-foreground">{retainDays}d</span>
            <span className="text-sm tabular-nums text-muted-foreground">{archiveDays != null ? `${archiveDays}d` : '—'}</span>
            <span className="text-sm tabular-nums text-muted-foreground">{purgeDays != null ? `${purgeDays}d` : '—'}</span>
            <div className="flex items-center gap-2">
              {saved && <Check className="h-4 w-4 text-emerald-500" />}
              <button onClick={() => setEditing(true)} className="text-xs text-primary hover:underline">
                Edit
              </button>
            </div>
          </>
        )}
      </div>
      {error && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}
    </div>
  )
}

function RetentionTab({ policies }: { policies: RetentionPolicy[] }) {
  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-sm text-muted-foreground">
        Control how long data is kept, when it moves to archive storage, and when it is permanently purged. Leave archive or purge blank to disable that phase.
      </p>
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-[160px_1fr_1fr_1fr_120px] border-b border-border bg-muted/30 px-4 py-2.5 gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entity</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Retain (days)</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Archive After</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Purge After</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Action</span>
        </div>
        {policies.map((p) => (
          <RetentionRow key={p.id} policy={p} />
        ))}
      </div>
    </div>
  )
}

function DeskTimeCard({ status }: { status: SettingsClientProps['deskTimeStatus'] }) {
  const [apiKey, setApiKey]           = useState('')
  const [editing, setEditing]         = useState(false)
  const [saved, setSaved]             = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [isPending, startTransition]  = useTransition()

  function handleSave() {
    if (!apiKey.trim()) { setError('Enter a DeskTime API key.'); return }
    setError(null)
    startTransition(async () => {
      const result = await saveDeskTimeApiKey(apiKey.trim())
      if (result.error) { setError(result.error); return }
      setApiKey('')
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })
  }

  function handleDisconnect() {
    setError(null)
    startTransition(async () => {
      const result = await disconnectDeskTime()
      if (result.error) setError(result.error)
    })
  }

  const connectedDate = status.connectedAt
    ? new Date(status.connectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-4 shadow-sm space-y-3">
      <div className="flex items-start gap-3">
        {status.connected
          ? <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
          : <Link2Off className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <div className="flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">DeskTime</p>
            {saved && <Check className="h-3.5 w-3.5 text-emerald-500" />}
          </div>
          <p className="text-xs text-muted-foreground">Pulls team time-tracking data into Projects reporting.</p>
          {status.connected && connectedDate && (
            <p className="text-xs text-muted-foreground/70 font-mono">Connected {connectedDate}</p>
          )}
        </div>
      </div>

      {editing ? (
        <div className="flex items-center gap-2 pl-6">
          <input
            type="password"
            autoFocus
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="DeskTime API key"
            className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button onClick={handleSave} disabled={isPending} className="btn-gradient disabled:opacity-40">
            <Save className="h-3.5 w-3.5" />
            {isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => { setEditing(false); setApiKey(''); setError(null) }}
            className="btn-soft"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="pl-6 flex items-center gap-3">
          <button onClick={() => setEditing(true)} className="text-xs text-primary hover:underline">
            {status.connected ? 'Update key' : 'Connect DeskTime'}
          </button>
          {status.connected && (
            <button
              onClick={handleDisconnect}
              disabled={isPending}
              className="text-xs text-red-600 hover:underline disabled:opacity-40"
            >
              {isPending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="pl-6 flex items-center gap-2 text-xs text-red-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}
    </div>
  )
}

function IntegrationsTab({ status, deskTimeStatus }: {
  status: SettingsClientProps['integrationStatus']
  deskTimeStatus: SettingsClientProps['deskTimeStatus']
}) {
  const integrations = [
    {
      name: 'Email (Resend)',
      description: 'Transactional email for notifications and reports.',
      enabled: status.resendKeySet,
      detail: status.resendKeySet && status.resendKeyMasked
        ? `API key: ••••${status.resendKeyMasked}`
        : 'RESEND_API_KEY not set — email delivery is disabled.',
    },
    {
      name: 'Business Rules Cron',
      description: 'Wire to /api/business-rules/run — see .claude/cron.md',
      enabled: false,
      detail: 'Schedule a cron job to POST /api/business-rules/run on your desired cadence.',
    },
    {
      name: 'Alert Cron',
      description: 'Wire to /api/alerts/run — see .claude/cron.md',
      enabled: false,
      detail: 'Schedule a cron job to POST /api/alerts/run on your desired cadence.',
    },
    {
      name: 'Report Cron',
      description: 'Wire to /api/reports/send — see .claude/cron.md',
      enabled: false,
      detail: 'Schedule a cron job to POST /api/reports/send on your desired cadence.',
    },
  ]

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-muted-foreground">
        Most integration status is derived from environment variables and cannot be edited here — DeskTime is the exception, connected below.
      </p>
      <DeskTimeCard status={deskTimeStatus} />
      <div className="space-y-3">
        {integrations.map((intg) => (
          <div key={intg.name} className="rounded-xl border border-border bg-card px-4 py-4 shadow-sm">
            <div className="flex items-start gap-3">
              <Circle
                className={`mt-0.5 h-3 w-3 shrink-0 fill-current ${intg.enabled ? 'text-emerald-500' : 'text-red-400'}`}
              />
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">{intg.name}</p>
                <p className="text-xs text-muted-foreground">{intg.description}</p>
                <p className="text-xs text-muted-foreground/70 font-mono">{intg.detail}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SettingsClient({ autoCloseDays, retentionPolicies, integrationStatus, deskTimeStatus }: SettingsClientProps) {
  const [tab, setTab] = useState<Tab>('general')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'general',      label: 'General' },
    { key: 'retention',    label: 'Retention' },
    { key: 'integrations', label: 'Integrations' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-[11px] font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general'      && <GeneralTab autoCloseDays={autoCloseDays} />}
      {tab === 'retention'    && <RetentionTab policies={retentionPolicies} />}
      {tab === 'integrations' && <IntegrationsTab status={integrationStatus} deskTimeStatus={deskTimeStatus} />}
    </div>
  )
}
