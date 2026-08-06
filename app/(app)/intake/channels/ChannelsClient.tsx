'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, Mail, Globe, MessageSquare, Trash2, Play, Pause, Radio, Plug, CheckCircle2, RefreshCw, History, Pencil } from 'lucide-react'
import {
  createChannel, updateChannel, setChannelStatus, deleteChannel, connectChannel, testChannel, pollNow, resyncChannel,
  getChannelConnectionInfo,
} from '@/lib/actions/intake/channels'
import type { IntakeChannel } from '@/lib/queries/intake'

// Common mailbox folders per provider — Gmail labels are exposed as IMAP folders
// under [Gmail]/. Detected from the host so app-password Gmail (provider 'imap',
// host imap.gmail.com) also gets the Gmail list.
const FOLDER_PRESETS: Record<'gmail' | 'm365' | 'default', { value: string; label: string }[]> = {
  gmail: [
    { value: 'INBOX', label: 'Inbox' },
    { value: '[Gmail]/All Mail', label: 'All Mail (entire account)' },
    { value: '[Gmail]/Important', label: 'Important' },
    { value: '[Gmail]/Starred', label: 'Starred' },
    { value: '[Gmail]/Sent Mail', label: 'Sent Mail' },
    { value: '[Gmail]/Spam', label: 'Spam' },
  ],
  m365: [
    { value: 'INBOX', label: 'Inbox' },
    { value: 'Archive', label: 'Archive' },
    { value: 'Junk Email', label: 'Junk Email' },
    { value: 'Sent Items', label: 'Sent Items' },
  ],
  default: [
    { value: 'INBOX', label: 'Inbox' },
    { value: 'Archive', label: 'Archive' },
    { value: 'Sent', label: 'Sent' },
    { value: 'Junk', label: 'Junk' },
    { value: 'Trash', label: 'Trash' },
  ],
}

function presetsFor(host: string, provider: string | null) {
  const h = (host ?? '').toLowerCase()
  if (h.includes('gmail') || provider === 'gmail') return FOLDER_PRESETS.gmail
  if (h.includes('office365') || h.includes('outlook') || provider === 'm365') return FOLDER_PRESETS.m365
  return FOLDER_PRESETS.default
}

const CUSTOM_FOLDER = '__custom__'

function FolderSelect({ host, provider, value, onChange }: {
  host: string; provider: string | null; value: string; onChange: (v: string) => void
}) {
  const presets = presetsFor(host, provider)
  const inPresets = presets.some((p) => p.value === value)
  const [custom, setCustom] = useState(!inPresets && Boolean(value))

  if (custom) {
    return (
      <div className="flex gap-2">
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Folder path (e.g. [Gmail]/All Mail)"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <button type="button" onClick={() => { setCustom(false); onChange('INBOX') }}
          className="shrink-0 rounded-lg border border-border px-2 text-xs text-muted-foreground hover:bg-muted">
          Presets
        </button>
      </div>
    )
  }
  return (
    <select
      value={value}
      onChange={(e) => { if (e.target.value === CUSTOM_FOLDER) setCustom(true); else onChange(e.target.value) }}
      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
    >
      {presets.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      {!inPresets && value && <option value={value}>{value}</option>}
      <option value={CUSTOM_FOLDER}>Custom…</option>
    </select>
  )
}

function formatPolled(iso: string | null): string {
  if (!iso) return 'never polled'
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return `polled ${secs}s ago`
  if (secs < 3600) return `polled ${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `polled ${Math.round(secs / 3600)}h ago`
  return `polled ${Math.round(secs / 86400)}d ago`
}

type ChannelType = 'email' | 'portal' | 'whatsapp' | 'teams' | 'slack' | 'api'

const TYPE_META: Record<ChannelType, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  email:    { label: 'Email',    icon: Mail },
  portal:   { label: 'Portal',   icon: Globe },
  whatsapp: { label: 'WhatsApp', icon: MessageSquare },
  teams:    { label: 'Teams',    icon: MessageSquare },
  slack:    { label: 'Slack',    icon: MessageSquare },
  api:      { label: 'API',      icon: Radio },
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  paused: 'bg-amber-50 text-amber-700 border-amber-200',
  error:  'bg-rose-50 text-rose-700 border-rose-200',
}

export function ChannelsClient({
  initialChannels,
  teams,
}: {
  initialChannels: IntakeChannel[]
  teams: { id: string; name: string }[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Surface the OAuth callback outcome (?oauth=...) as a toast, then clean the URL.
  useEffect(() => {
    const oauth = searchParams.get('oauth')
    if (!oauth) return
    const mode = searchParams.get('mode')
    const messages: Record<string, [string, 'success' | 'error']> = {
      connected: mode === 'push'
        ? ['Mailbox connected — real-time push active (no polling needed).', 'success']
        : ['Mailbox connected via OAuth — polling is active.', 'success'],
      denied:         ['Authorization was cancelled.', 'error'],
      noemail:        ['Could not read the mailbox address from the provider.', 'error'],
      exchangefailed: ['Token exchange failed — check the OAuth client config.', 'error'],
      unconfigured:   ['OAuth client is not configured on the server.', 'error'],
      vaultfailed:    ['Could not store the credentials securely.', 'error'],
      badstate:       ['OAuth session expired — please try again.', 'error'],
      forbidden:      ['You do not have permission to connect channels.', 'error'],
    }
    const m = messages[oauth] ?? ['OAuth could not complete.', 'error'] as [string, 'error']
    if (m[1] === 'success') toast.success(m[0]); else toast.error(m[0])
    router.replace('/intake/channels')
  }, [searchParams, router])

  // form state
  const [name, setName] = useState('')
  const [type, setType] = useState<ChannelType>('email')
  const [provider, setProvider] = useState('imap')
  const [teamId, setTeamId] = useState('')
  // Default: sync from 30 days ago so old mail isn't pulled in bulk.
  const [syncFromDate, setSyncFromDate] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })

  function resetForm() {
    setName(''); setType('email'); setProvider('imap'); setTeamId('')
    const d = new Date(); d.setDate(d.getDate() - 30)
    setSyncFromDate(d.toISOString().split('T')[0])
    setShowForm(false)
  }

  function handleCreate() {
    if (!name.trim()) { toast.error('Channel name is required.'); return }
    startTransition(async () => {
      const res = await createChannel({
        name,
        type,
        provider: type === 'email' ? provider : null,
        default_team_id: teamId || null,
        config: type === 'email' && syncFromDate ? { sync_from_date: syncFromDate } : {},
      })
      if (res.error) { toast.error(res.error); return }
      toast.success('Channel created — paused until credentials are connected.')
      resetForm()
      router.refresh()
    })
  }

  function handleToggle(ch: IntakeChannel) {
    // Only a paused channel activates; active OR error pauses (so an errored
    // channel can be silenced instead of being re-polled into the same error).
    const next = ch.status === 'paused' ? 'active' : 'paused'
    startTransition(async () => {
      const res = await setChannelStatus(ch.id, next)
      if (res.error) { toast.error(res.error); return }
      toast.success(next === 'active' ? 'Channel activated.' : 'Channel paused.')
      router.refresh()
    })
  }

  function handleDelete(ch: IntakeChannel) {
    if (!confirm(
      `Delete channel "${ch.name}"?\n\n` +
      `• All emails received through this mailbox will be permanently deleted.\n` +
      `• Tasks and Requests already created from those emails will be KEPT ` +
      `(they stay in your system with their "Intake" source).\n\n` +
      `This cannot be undone.`
    )) return
    startTransition(async () => {
      const res = await deleteChannel(ch.id)
      if (res.error) { toast.error(res.error); return }
      toast.success('Channel deleted.')
      router.refresh()
    })
  }

  function handleTest(ch: IntakeChannel) {
    startTransition(async () => {
      const res = await testChannel(ch.id)
      if (res.ok) toast.success('Connection successful.')
      else toast.error(res.error ?? 'Connection failed.')
    })
  }

  function handleResync(ch: IntakeChannel) {
    const syncFrom = (ch.config as Record<string, unknown>)?.sync_from_date as string | undefined
    const dateNote = syncFrom ? ` (from ${syncFrom} onwards — set in channel settings)` : ' (entire mailbox history)'
    if (!confirm(`Re-pull the mailbox for "${ch.name}"${dateNote}?\n\nExisting mail is backfilled; duplicates are skipped automatically.`)) return
    startTransition(async () => {
      const res = await resyncChannel(ch.id)
      if (res.error) { toast.error(res.error); return }
      toast.success('Cursor reset — the next poll will re-pull the whole mailbox. Use "Poll now" to run it immediately.')
      router.refresh()
    })
  }

  function handlePollNow() {
    startTransition(async () => {
      const res = await pollNow()
      if (!res.ok) { toast.error(res.error ?? 'Poll failed.'); return }
      const total = res.stored ?? 0
      if (total > 0) toast.success(`Polled ${res.channels ?? 0} channel(s) — ${total} new message(s) ingested.`)
      else toast.info(`Polled ${res.channels ?? 0} channel(s) — no new mail.`)
      // Surface per-channel failures so the operator sees the real cause.
      for (const d of res.details ?? []) {
        if (d.error) {
          const name = initialChannels.find((c) => c.id === d.id)?.name ?? 'channel'
          toast.error(`${name}: ${d.error}`)
        }
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button
          onClick={handlePollNow}
          disabled={isPending}
          title="Fetch new mail from all active channels now"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} /> Poll now
        </button>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:brightness-110"
        >
          <Plus className="h-3.5 w-3.5" /> New channel
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Support Inbox"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ChannelType)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                {Object.entries(TYPE_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            {type === 'email' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">Provider</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="imap">IMAP</option>
                  <option value="m365">Microsoft 365</option>
                  <option value="gmail">Gmail</option>
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Default team (optional)</label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">— None —</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            {type === 'email' && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-foreground">
                  Sync &amp; classify emails from
                  <span className="ml-1.5 font-normal text-muted-foreground">(emails before this date will not be pulled or classified)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={syncFromDate}
                    onChange={(e) => setSyncFromDate(e.target.value)}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                  <button type="button" onClick={() => setSyncFromDate('')}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
                    Clear (sync all)
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={isPending}
              className="rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:brightness-110 disabled:opacity-50"
            >
              {isPending ? 'Creating…' : 'Create channel'}
            </button>
          </div>
        </div>
      )}

      {initialChannels.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <Radio className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <h2 className="mt-3 text-sm font-semibold text-foreground">No channels configured</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Create a channel to define an inbound source. Credential connection and polling
            arrive with email ingestion (Phase B).
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {initialChannels.map((ch) => {
            const meta = TYPE_META[ch.type]
            const Icon = meta?.icon ?? Radio
            return (
              <div key={ch.id}>
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{ch.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {meta?.label ?? ch.type}{ch.provider ? ` · ${ch.provider}` : ''}
                    {ch.type === 'email' && (ch.config as Record<string,unknown>)?.push_mode
                      ? <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">real-time push</span>
                      : ch.type === 'email' ? ` · ${formatPolled(ch.last_polled_at)}` : null}
                    {ch.type === 'email' && (ch.config as Record<string,unknown>)?.sync_from_date
                      ? <span className="ml-1 text-muted-foreground/70">· from {(ch.config as Record<string,unknown>).sync_from_date as string}</span>
                      : null}
                    {ch.last_error ? <span className="text-rose-600"> · {ch.last_error}</span> : ''}
                  </p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[ch.status] ?? 'bg-muted text-muted-foreground border-border'}`}>
                  {ch.status}
                </span>
                <button
                  onClick={() => { setEditingId(editingId === ch.id ? null : ch.id); setConnectingId(null) }}
                  disabled={isPending}
                  title="Edit channel"
                  className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {ch.type === 'email' && (
                  <>
                    <button
                      onClick={() => { setConnectingId(connectingId === ch.id ? null : ch.id); setEditingId(null) }}
                      disabled={isPending}
                      title="Connect credentials"
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <Plug className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleTest(ch)}
                      disabled={isPending}
                      title="Test connection"
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleResync(ch)}
                      disabled={isPending}
                      title="Resync — re-pull the whole mailbox"
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <History className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => handleToggle(ch)}
                  disabled={isPending}
                  title={ch.status === 'paused' ? 'Activate' : 'Pause'}
                  className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  {ch.status === 'paused' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => handleDelete(ch)}
                  disabled={isPending}
                  title="Delete"
                  className="rounded-lg border border-border p-1.5 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {editingId === ch.id && (
                <EditChannelForm
                  channel={ch}
                  teams={teams}
                  isPending={isPending}
                  onCancel={() => setEditingId(null)}
                  onSubmit={(patch, creds) => {
                    startTransition(async () => {
                      const res = await updateChannel(ch.id, patch)
                      if (res.error) { toast.error(res.error); return }
                      // Save IMAP configuration too when present (OAuth providers skip this).
                      if (creds) {
                        const c = await connectChannel(ch.id, creds)
                        if (c.error) { toast.error(c.error); return }
                      }
                      toast.success('Channel updated.')
                      setEditingId(null)
                      router.refresh()
                    })
                  }}
                />
              )}
              {connectingId === ch.id && (
                ch.provider === 'gmail' || ch.provider === 'm365' ? (
                  <OAuthConnect channel={ch} onCancel={() => setConnectingId(null)} />
                ) : (
                  <ConnectForm
                    channel={ch}
                    isPending={isPending}
                    onCancel={() => setConnectingId(null)}
                    onSubmit={(creds) => {
                      startTransition(async () => {
                        const res = await connectChannel(ch.id, creds)
                        if (res.error) { toast.error(res.error); return }
                        toast.success('Credentials saved to Vault. Use Test to verify, then Activate.')
                        setConnectingId(null)
                        router.refresh()
                      })
                    }}
                  />
                )
              )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EditChannelForm({
  channel, teams, isPending, onCancel, onSubmit,
}: {
  channel: IntakeChannel
  teams: { id: string; name: string }[]
  isPending: boolean
  onCancel: () => void
  onSubmit: (
    patch: { name?: string; provider?: string | null; default_team_id?: string | null; config?: Record<string, unknown> },
    creds?: { host: string; port: number; secure: boolean; user: string; password: string; folder: string },
  ) => void
}) {
  const [name, setName] = useState(channel.name)
  const [provider, setProvider] = useState(channel.provider ?? 'imap')
  const [teamId, setTeamId] = useState(channel.default_team_id ?? '')
  const [syncFromDate, setSyncFromDate] = useState<string>((channel.config?.sync_from_date as string) ?? '')

  // Connection config (IMAP). Pre-filled from the stored secret on open.
  const [host, setHost] = useState((channel.config?.host as string) ?? '')
  const [port, setPort] = useState((channel.config?.port as number) ?? 993)
  const [secure, setSecure] = useState((channel.config?.secure as boolean) ?? true)
  const [user, setUser] = useState((channel.config?.user as string) ?? '')
  const [password, setPassword] = useState('')
  const [folder, setFolder] = useState((channel.config?.folder as string) ?? 'INBOX')
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(channel.type === 'email')

  useEffect(() => {
    if (channel.type !== 'email') return
    let active = true
    getChannelConnectionInfo(channel.id).then((info) => {
      if (!active || info.error) { setLoading(false); return }
      setConnected(Boolean(info.connected))
      if (info.host !== undefined) setHost(info.host)
      if (info.port !== undefined) setPort(info.port)
      if (info.secure !== undefined) setSecure(info.secure)
      if (info.user !== undefined) setUser(info.user)
      if (info.folder !== undefined) setFolder(info.folder)
      setLoading(false)
    })
    return () => { active = false }
  }, [channel.id, channel.type])

  const isOAuth = provider === 'gmail' || provider === 'm365'
  const oauthProvider = provider === 'gmail' ? 'google' : 'microsoft'
  const oauthLabel = provider === 'gmail' ? 'Google' : 'Microsoft'

  function handleSave() {
    if (!name.trim()) { toast.error('Name is required.'); return }
    // Merge sync_from_date into existing config so other keys (push_mode, etc.) survive.
    const configPatch = { ...(channel.config ?? {}), sync_from_date: syncFromDate || null }
    const patch = {
      name: name.trim(),
      provider: channel.type === 'email' ? provider : channel.provider,
      default_team_id: teamId || null,
      config: configPatch,
    }
    // IMAP channels also save the connection config; OAuth uses the button below.
    if (channel.type === 'email' && !isOAuth) {
      if (!host.trim() || !user.trim()) { toast.error('Host and email are required.'); return }
      onSubmit(patch, { host, port, secure, user, password, folder })
    } else {
      onSubmit(patch)
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Edit channel — name, routing &amp; configuration
        {loading && <span className="ml-2 font-normal normal-case text-muted-foreground/60">loading current settings…</span>}
      </p>

      {/* Header fields */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Channel name"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        </div>
        {channel.type === 'email' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">Provider</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <option value="imap">IMAP (password / app password)</option>
              <option value="m365">Microsoft 365 (OAuth)</option>
              <option value="gmail">Gmail (OAuth)</option>
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">Default team</label>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
            <option value="">— None —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {channel.type === 'email' && (
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-foreground">
              Sync &amp; classify emails from
              <span className="ml-1.5 font-normal text-muted-foreground">(emails before this date are not pulled or classified)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={syncFromDate}
                onChange={(e) => setSyncFromDate(e.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              <button type="button" onClick={() => setSyncFromDate('')}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
                Clear (sync all)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Connection config — IMAP shows fields, OAuth shows a connect button */}
      {channel.type === 'email' && !isOAuth && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Mailbox connection — encrypted in Supabase Vault
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">IMAP host</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.gmail.com"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Port</label>
              <input value={port} onChange={(e) => setPort(parseInt(e.target.value, 10) || 993)} type="number"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Email / username</label>
              <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="you@example.com" autoComplete="off"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Password / app password</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password"
                placeholder={connected ? 'Leave blank to keep current' : 'Password / app password'} autoComplete="new-password"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Folder</label>
              <FolderSelect host={host} provider={provider} value={folder} onChange={setFolder} />
            </div>
            <label className="flex items-center gap-2 self-end px-1 pb-2 text-xs text-foreground">
              <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
              Use TLS (recommended)
            </label>
          </div>
        </div>
      )}

      {channel.type === 'email' && isOAuth && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {oauthLabel} OAuth — no password stored
          </p>
          <p className="text-xs text-muted-foreground">
            {user
              ? <>Connected as <span className="font-medium text-foreground">{user}</span>. Save header changes below, or reconnect to refresh mailbox access.</>
              : <>{oauthLabel} requires OAuth — save the provider change first, then use the button to sign in and grant mail access.</>}
          </p>
          {channel.provider === provider && (
            <a href={`/api/intake/oauth/start?channel=${channel.id}&provider=${oauthProvider}`}
              className="mt-2 inline-block rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted">
              {user ? `Reconnect with ${oauthLabel}` : `Connect with ${oauthLabel}`}
            </a>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={isPending || loading}
          className="rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:brightness-110 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

function OAuthConnect({ channel, onCancel }: { channel: IntakeChannel; onCancel: () => void }) {
  const provider = channel.provider === 'gmail' ? 'google' : 'microsoft'
  const label = channel.provider === 'gmail' ? 'Google' : 'Microsoft'
  const connectedEmail = channel.config?.user as string | undefined

  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label} OAuth — no password stored
      </p>
      <p className="text-xs text-muted-foreground">
        {connectedEmail
          ? <>Connected as <span className="font-medium text-foreground">{connectedEmail}</span>. Reconnect to refresh access or switch the mailbox.</>
          : <>{label} requires OAuth for mailbox access — account passwords no longer work. You&apos;ll be redirected to sign in and grant mail access.</>}
      </p>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
          Cancel
        </button>
        <a
          href={`/api/intake/oauth/start?channel=${channel.id}&provider=${provider}`}
          className="rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:brightness-110"
        >
          {connectedEmail ? `Reconnect with ${label}` : `Connect with ${label}`}
        </a>
      </div>
    </div>
  )
}

function ConnectForm({
  channel, isPending, onCancel, onSubmit,
}: {
  channel: IntakeChannel
  isPending: boolean
  onCancel: () => void
  onSubmit: (creds: { host: string; port: number; secure: boolean; user: string; password: string; folder: string }) => void
}) {
  const [host, setHost] = useState((channel.config?.host as string) ?? (channel.provider === 'gmail' ? 'imap.gmail.com' : ''))
  const [port, setPort] = useState((channel.config?.port as number) ?? 993)
  const [secure, setSecure] = useState((channel.config?.secure as boolean) ?? true)
  const [user, setUser] = useState((channel.config?.user as string) ?? '')
  const [password, setPassword] = useState('')
  const [folder, setFolder] = useState((channel.config?.folder as string) ?? 'INBOX')
  // Pull the stored connection settings (everything but the password) so editing
  // a channel pre-fills instead of forcing a full reconfigure.
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    getChannelConnectionInfo(channel.id).then((info) => {
      if (!active || info.error) { setLoading(false); return }
      setConnected(Boolean(info.connected))
      if (info.host !== undefined) setHost(info.host)
      if (info.port !== undefined) setPort(info.port)
      if (info.secure !== undefined) setSecure(info.secure)
      if (info.user !== undefined) setUser(info.user)
      if (info.folder !== undefined) setFolder(info.folder)
      setLoading(false)
    })
    return () => { active = false }
  }, [channel.id])

  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/20 p-3 space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {connected ? 'Edit IMAP configuration' : 'IMAP configuration'} — encrypted in Supabase Vault
        {loading && <span className="ml-2 font-normal normal-case text-muted-foreground/60">loading current settings…</span>}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="IMAP host (e.g. imap.gmail.com)"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input value={port} onChange={(e) => setPort(parseInt(e.target.value, 10) || 993)} type="number" placeholder="Port (993)"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Username / email" autoComplete="off"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password"
          placeholder={connected ? 'Password — leave blank to keep current' : 'Password / app password'} autoComplete="new-password"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
        <FolderSelect host={host} provider={channel.provider} value={folder} onChange={setFolder} />
        <label className="flex items-center gap-2 px-1 text-xs text-foreground">
          <input type="checkbox" checked={secure} onChange={(e) => setSecure(e.target.checked)} />
          Use TLS (recommended)
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted">
          Cancel
        </button>
        <button
          onClick={() => onSubmit({ host, port, secure, user, password, folder })}
          disabled={isPending || loading}
          className="rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:brightness-110 disabled:opacity-50"
        >
          {isPending ? 'Saving…' : connected ? 'Save changes' : 'Save credentials'}
        </button>
      </div>
    </div>
  )
}
