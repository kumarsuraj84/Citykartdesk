'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Save, Check, AlertTriangle, Circle, Mail, MessageSquare, ChevronDown, ExternalLink, Send } from 'lucide-react'
import { updateEmailFromSettings, updateRetentionPolicy, sendTestEmail } from '@/lib/actions/admin/config'
import { EMAIL_REGEX } from '@/lib/validation/formFields'
import type { WhatsAppChannelReadiness } from '@/lib/actions/intake/whatsapp-channel'

type Tab = 'retention' | 'integrations'

interface RetentionPolicy {
  id: string
  entity_type: string
  retention_days: number
  archive_after_days: number | null
  purge_after_days: number | null
  is_active: boolean
}

interface WhatsAppChannelSummary {
  id: string
  name: string
  status: string
  readiness: WhatsAppChannelReadiness | null
}

interface SettingsClientProps {
  retentionPolicies: RetentionPolicy[]
  integrationStatus: {
    provider: 'smtp' | 'resend' | null
    /** Non-secret description of the active connection, e.g. the SMTP host and login. */
    detail: string | null
    /** With SMTP, the mailbox address mail is really sent as (Google rewrites any other). */
    sendingAs: string | null
  }
  emailFrom: {
    name: string
    address: string
  }
  whatsappChannels: WhatsAppChannelSummary[]
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

// The whole app's email story lives in one card: what address it sends as,
// whether Resend can actually deliver it, and — since the two behave very
// differently — a clear split between mail that goes out the instant an
// event happens (notifications, OEM routing; no scheduler involved) and mail
// that depends on a recurring job existing (due-soon/overdue alerts, the
// daily digest, SLA-escalation rules). Merged from four previously separate
// cards (sender address, Resend status, Business Rules Cron, Alert Cron) —
// they were four facets of one "how does this app send email" question, not
// four independent integrations.
function EmailCard({
  initial, delivery,
}: {
  initial: SettingsClientProps['emailFrom']
  delivery: SettingsClientProps['integrationStatus']
}) {
  const [name, setName] = useState(initial.name)
  const [address, setAddress] = useState(initial.address)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [testTo, setTestTo] = useState('')
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testPending, startTest] = useTransition()

  const connected = delivery.provider !== null
  const addressLocked = delivery.provider === 'smtp' && !!delivery.sendingAs
  const effective = delivery.sendingAs || address.trim() || 'noreply@citykart.org (default — not yet configured)'

  function handleSave() {
    const trimmedAddress = address.trim()
    if (trimmedAddress && !EMAIL_REGEX.test(trimmedAddress)) {
      setError('That doesn\'t look like a valid email address.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await updateEmailFromSettings(name.trim(), trimmedAddress)
      if (result.error) { setError(result.error); return }
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })
  }

  function handleTest() {
    const to = testTo.trim()
    if (!EMAIL_REGEX.test(to)) {
      setTestMsg({ ok: false, text: 'Enter a valid email address to send the test to.' })
      return
    }
    setTestMsg(null)
    startTest(async () => {
      const r = await sendTestEmail(to)
      setTestMsg(
        r.error
          ? { ok: false, text: r.error }
          : { ok: true, text: `Test email sent to ${to}. Check the inbox (and the spam folder).` }
      )
    })
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm divide-y divide-border">
      {/* Identity — the one address everything sends from */}
      <div className="flex items-start gap-3 px-4 py-4">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Email Sending</p>
              <p className="text-xs text-muted-foreground">
                One address for everything this desk emails — ticket notifications, OEM routing, and escalation
                alerts all send from this identity. The display name can be changed here anytime; no code change or redeploy needed.
              </p>
            </div>
            {!editing && (
              <div className="flex shrink-0 items-center gap-2">
                {saved && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                    <Check className="h-3.5 w-3.5" /> Saved
                  </span>
                )}
                <button onClick={() => setEditing(true)} className="btn-soft">Edit</button>
              </div>
            )}
          </div>

          {editing ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground">Display name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Citykart Desk"
                    className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-muted-foreground">Email address</span>
                  <input
                    value={addressLocked ? (delivery.sendingAs ?? '') : address}
                    onChange={(e) => setAddress(e.target.value)}
                    disabled={addressLocked}
                    placeholder="servicedesk@citykart.org"
                    className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                  />
                </label>
              </div>
              {addressLocked && (
                <p className="text-[11px] text-muted-foreground">
                  The address is fixed to the mailbox the server signs in with — Google only allows a mailbox to send as itself.
                </p>
              )}
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button onClick={handleSave} disabled={isPending} className="btn-gradient disabled:opacity-40">
                  <Save className="h-3.5 w-3.5" />
                  {isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => { setEditing(false); setName(initial.name); setAddress(initial.address); setError(null) }}
                  className="btn-soft"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm font-mono text-foreground">
              {name.trim() || 'Citykart Desk'} &lt;{effective}&gt;
            </p>
          )}

          <button
            onClick={() => setShowGuide((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-primary"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showGuide ? 'rotate-180' : ''}`} />
            How do I set this up?
          </button>

          {showGuide && (
            <ol className="space-y-2 rounded-lg bg-muted/40 px-4 py-3 text-xs text-muted-foreground list-decimal list-inside">
              <li>
                Create the mailbox in Google Workspace (e.g. <span className="font-mono">citykartdesk@citykartstores.com</span>) —
                replies to notifications land in this inbox.
              </li>
              <li>
                Sign in to that mailbox&apos;s Google Account, turn on <strong>2-Step Verification</strong>, then
                Security → <strong>App passwords</strong> → create one named &quot;Citykart Desk&quot; and copy the 16-character password.
                (If App passwords isn&apos;t offered, a Workspace admin must allow it for this account.)
              </li>
              <li>
                On the server, add these to the app&apos;s <span className="font-mono">.env.local</span> and restart the app:{' '}
                <span className="font-mono">SMTP_HOST=smtp.gmail.com</span>, <span className="font-mono">SMTP_PORT=587</span>,{' '}
                <span className="font-mono">SMTP_USER=citykartdesk@citykartstores.com</span>,{' '}
                <span className="font-mono">SMTP_PASS=&lt;the app password&gt;</span>. The password stays on the server only.
              </li>
              <li>Come back here — Delivery below turns green. Then use <strong>Send a test email</strong> to confirm it arrives.</li>
              <li>
                Optional: set the display name above. Instead of an app password you can use Google&apos;s SMTP relay
                (<span className="font-mono">smtp-relay.gmail.com</span>, allow-listed by server IP, no password), or the
                Resend service (<span className="font-mono">RESEND_API_KEY</span>) — SMTP is used first when both are set.
              </li>
            </ol>
          )}
        </div>
      </div>

      {/* Delivery — can mail actually leave the system at all */}
      <div className="flex items-start gap-3 px-4 py-3.5">
        <Circle
          className={`mt-1 h-2.5 w-2.5 shrink-0 fill-current ${connected ? 'text-emerald-500' : 'text-red-400'}`}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-sm font-medium text-foreground">
            Delivery via {delivery.provider === 'smtp' ? 'SMTP (mail server)' : delivery.provider === 'resend' ? 'Resend' : 'email'}
          </p>
          <p className="text-xs text-muted-foreground/80 font-mono">
            {connected && delivery.detail
              ? `Configured — ${delivery.detail}`
              : 'Not configured — nothing below can actually send until SMTP_HOST (or RESEND_API_KEY) is set on the server.'}
          </p>
          {connected && (
            <div className="space-y-1.5 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="send a test email to…"
                  className="min-w-[220px] flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button onClick={handleTest} disabled={testPending} className="btn-soft disabled:opacity-40">
                  <Send className="h-3.5 w-3.5" />
                  {testPending ? 'Sending…' : 'Send a test email'}
                </button>
              </div>
              {testMsg && (
                <p className={`text-xs ${testMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{testMsg.text}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Where this address is used — instant vs. needs-a-scheduler */}
      <div className="px-4 py-3.5 space-y-2.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Where this address is used</p>
        <div className="flex items-start gap-2.5">
          <Circle
            className={`mt-1 h-2.5 w-2.5 shrink-0 fill-current ${connected ? 'text-emerald-500' : 'text-red-400'}`}
          />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Ticket notifications & OEM routing</span> — sent the
            instant an event happens (assignment, comments, status changes, OEM auto-routing) per your{' '}
            Notification Rules. No schedule required — this works as soon as Delivery above is connected.
          </p>
        </div>
        <div className="flex items-start gap-2.5">
          <Circle className="mt-1 h-2.5 w-2.5 shrink-0 fill-current text-red-400" />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Due-soon/overdue alerts, daily digest & SLA escalation</span> —
            time-based, so something must call <span className="font-mono">/api/alerts/run</span> and{' '}
            <span className="font-mono">/api/business-rules/run</span> on a recurring schedule (see{' '}
            <span className="font-mono">.claude/cron.md</span>). Not scheduled in this environment yet.
          </p>
        </div>
      </div>
    </div>
  )
}

// One-glance CONFIGURED-vs-VERIFIED status, reusing Stage 6's own
// readiness diagnostic (getWhatsAppChannelReadiness) rather than
// re-deriving it. Credential entry/editing and the full Test Connection
// flow stay on the dedicated Admin > Intake > Channels page — this card
// exists so that page's status is visible from one stable, non-module-
// gated location, not to duplicate its management UI.
function WhatsAppCard({ channel }: { channel: WhatsAppChannelSummary }) {
  const r = channel.readiness

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm divide-y divide-border">
      <div className="flex items-start gap-3 px-4 py-4">
        <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">{channel.name}</p>
              <p className="text-xs text-muted-foreground">
                WhatsApp intake — requesters can start a ticket by messaging this number. Managed from Admin &gt; Intake &gt; Channels.
              </p>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              channel.status === 'active' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-border bg-muted text-muted-foreground'
            }`}>
              {channel.status}
            </span>
          </div>
        </div>
      </div>

      {r ? (
        <>
          <div className="flex items-start gap-3 px-4 py-3.5">
            <Circle className={`mt-1 h-2.5 w-2.5 shrink-0 fill-current ${r.credentialsConfigured && r.phoneNumberIdConfigured ? 'text-emerald-500' : 'text-red-400'}`} />
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">Configured</p>
              <p className="text-xs text-muted-foreground/80">
                Phone Number ID {r.phoneNumberIdConfigured ? 'set' : 'missing'} · WABA ID {r.wabaIdConfigured ? 'set' : 'not set'} · Credentials {r.credentialsConfigured ? 'stored in Vault' : 'not entered yet'}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 px-4 py-3.5">
            <Circle className={`mt-1 h-2.5 w-2.5 shrink-0 fill-current ${r.metaConnectionVerified ? 'text-emerald-500' : 'text-red-400'}`} />
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">Meta connection verified</p>
              <p className="text-xs text-muted-foreground/80 font-mono">
                {r.metaConnectionVerified
                  ? `Verified ${r.metaConnectionLastTestedAt ? new Date(r.metaConnectionLastTestedAt).toLocaleString() : ''}${r.metaDisplayPhoneNumber ? ` — ${r.metaDisplayPhoneNumber}` : ''}`
                  : r.metaConnectionLastTestedAt
                    ? `Last attempt failed (${new Date(r.metaConnectionLastTestedAt).toLocaleString()}): ${r.metaConnectionLastError ?? 'unknown error'}`
                    : 'Never tested — credentials being present does not mean Meta has accepted them.'}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 px-4 py-3.5">
            <Circle className={`mt-1 h-2.5 w-2.5 shrink-0 fill-current ${
              r.webhookHealth === 'ok' ? 'text-emerald-500' : r.webhookHealth === 'errors_detected' ? 'text-red-400' : 'text-amber-400'
            }`} />
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-foreground">Webhook health</p>
              <p className="text-xs text-muted-foreground/80">{r.webhookHealthDetail ?? '—'}</p>
            </div>
          </div>
          <div className="px-4 py-3 text-xs text-muted-foreground">
            {r.requesterMobileCoverage.activeWithMobile} of {r.requesterMobileCoverage.activeUsers} active users have a mobile number on file — the rest can&apos;t use WhatsApp yet.
          </div>
        </>
      ) : (
        <div className="px-4 py-3 text-xs text-muted-foreground">
          Detailed status is only visible to admins/platform owners.
        </div>
      )}

      <div className="px-4 py-3">
        <Link href="/intake/channels" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Manage credentials & test connection <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  )
}

function IntegrationsTab({ status, emailFrom, whatsappChannels }: {
  status: SettingsClientProps['integrationStatus']
  emailFrom: SettingsClientProps['emailFrom']
  whatsappChannels: SettingsClientProps['whatsappChannels']
}) {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Every email this desk sends — notifications, OEM routing, and escalation alerts alike — goes out from one
          configured identity below.
        </p>
        <EmailCard initial={emailFrom} delivery={status} />
      </div>

      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          WhatsApp channels requesters can message to open a ticket. Configured vs. verified is shown separately —
          entering credentials doesn&apos;t mean Meta has accepted them yet.
        </p>
        {whatsappChannels.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
            <p className="text-sm text-muted-foreground">No WhatsApp channel configured yet.</p>
            <Link href="/intake/channels" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Set one up in Intake &gt; Channels <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {whatsappChannels.map((ch) => <WhatsAppCard key={ch.id} channel={ch} />)}
          </div>
        )}
      </div>
    </div>
  )
}

export function SettingsClient({ retentionPolicies, integrationStatus, emailFrom, whatsappChannels }: SettingsClientProps) {
  const [tab, setTab] = useState<Tab>('retention')

  const tabs: { key: Tab; label: string }[] = [
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

      {tab === 'retention'    && <RetentionTab policies={retentionPolicies} />}
      {tab === 'integrations' && <IntegrationsTab status={integrationStatus} emailFrom={emailFrom} whatsappChannels={whatsappChannels} />}
    </div>
  )
}
