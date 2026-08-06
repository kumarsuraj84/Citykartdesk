import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  Sparkles, Inbox, Radio, ArrowRight, Flag, CheckCheck, ArrowUpRight,
  Layers, Gauge, Mail, AlertTriangle, CheckCircle2, PauseCircle,
} from 'lucide-react'
import { getCurrentProfile } from '@/lib/queries/profiles'
import {
  getIntakeDashboardStats, getIntakeValidationStats, getIntakeReviewQueue,
  getInboxMessages, getIntakeChannels,
} from '@/lib/queries/intake'
import { PageHeader } from '@/components/ui/PageHeader'
import { formatRelativeTime } from '@/lib/utils'

const INTAKE_ROLES = ['agent', 'manager', 'admin', 'platform_owner']
const ADMIN_ROLES = ['admin', 'platform_owner']

const TYPE_CLS: Record<string, string> = {
  request:       'bg-blue-50 text-blue-700 border-blue-200',
  task:          'bg-violet-50 text-violet-700 border-violet-200',
  approval:      'bg-amber-50 text-amber-700 border-amber-200',
  informational: 'bg-teal-50 text-teal-700 border-teal-200',
  ignore:        'bg-gray-50 text-gray-500 border-gray-200',
}
const STAGE_LABEL: Record<string, string> = {
  rule: 'Stage 1 · Rules', local_model: 'Stage 2 · Model', premium_ai: 'Stage 3 · Premium', unknown: 'Unclassified',
}
const STAGE_DOT: Record<string, string> = {
  rule: 'bg-slate-400', local_model: 'bg-indigo-500', premium_ai: 'bg-fuchsia-500', unknown: 'bg-gray-300',
}

function senderLabel(addr: string | null): string {
  if (!addr) return '—'
  const m = addr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (m && m[1].trim()) return m[1].trim()
  return (m?.[2] ?? addr).trim()
}

function KpiCard({ label, value, sublabel, icon: Icon, href, accent }: {
  label: string; value: number | string; sublabel: string
  icon: React.ComponentType<{ className?: string }>; href?: string; accent?: string
}) {
  const inner = (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-indigo-300">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-indigo-400 via-violet-400 to-fuchsia-400 opacity-60" />
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-indigo-400" />
      </div>
      <p className={`mt-1 text-2xl font-bold ${accent ?? 'text-foreground'}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{sublabel}</p>
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

export default async function IntakeDashboardPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!INTAKE_ROLES.includes(profile.role)) redirect('/home')
  const isAdmin = ADMIN_ROLES.includes(profile.role)

  const [stats, validation, pending, recent, channels] = await Promise.all([
    getIntakeDashboardStats(),
    getIntakeValidationStats(),
    getIntakeReviewQueue({ state: 'pending', pageSize: 6 }),
    getInboxMessages({ pageSize: 8 }),
    getIntakeChannels(),
  ])

  const isEmpty = stats.channelCount === 0
  const conf = validation.byConfidence
  const confTotal = conf.low + conf.medium + conf.good + conf.high
  const avgConfidence = validation.total > 0
    ? Math.round(validation.byStage.reduce((s, x) => s + x.avgConfidence * x.total, 0) / validation.total)
    : 0
  // Auto-handled = high+good confidence (no human needed). A proxy for automation rate.
  const autoRate = confTotal > 0 ? Math.round(((conf.good + conf.high) / confTotal) * 100) : 0
  const topTypes = Object.entries(validation.byType).sort((a, b) => b[1] - a[1])
  const topDepts = Object.entries(validation.byDepartment).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const channelErrors = channels.filter((c) => c.status === 'error').length

  // ── First-run: no channels yet ──────────────────────────────────────────────
  if (isEmpty) {
    return (
      <div className="space-y-4">
        <PageHeader title="Intake Intelligence" description="Capture, triage, and convert inbound communications into work." />
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <h2 className="mt-3 text-sm font-semibold text-foreground">No channels yet</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Connect an inbox or other source to start capturing inbound messages. Once a
            channel is active, messages land in the inbox and the pipeline classifies them automatically.
          </p>
          {isAdmin && (
            <Link href="/intake/channels" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:brightness-110">
              Configure a channel <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Intake Intelligence" description="Capture, triage, and convert inbound communications into work." />

      {/* ── KPI strip ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <KpiCard label="New"          value={stats.newCount}      sublabel="Awaiting triage"  icon={Inbox}  href="/intake/inbox?folder=all" />
        <KpiCard label="Needs Review" value={stats.inReviewCount} sublabel="Pending decision" icon={Flag}   href="/intake/inbox?folder=review"
          accent={stats.inReviewCount > 0 ? 'text-amber-600' : undefined} />
        <KpiCard label="Converted"    value={stats.actionedCount} sublabel="Turned into work" icon={CheckCheck} href="/intake/inbox?folder=converted" />
        <KpiCard label="Auto-handled" value={validation.total > 0 ? `${autoRate}%` : '—'} sublabel="High confidence" icon={Gauge}
          accent={autoRate >= 70 ? 'text-emerald-600' : autoRate > 0 ? 'text-amber-600' : undefined} />
        <KpiCard label="Channels"     value={stats.activeChannelCount} sublabel={channelErrors > 0 ? `${channelErrors} in error` : `${stats.channelCount} configured`}
          icon={Radio} href="/intake/channels" accent={channelErrors > 0 ? 'text-rose-600' : undefined} />
      </div>

      {/* ── Pipeline health ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Layers className="h-4 w-4 text-muted-foreground" />
            Pipeline health
          </div>
          {isAdmin && (
            <Link href="/intake/settings" className="flex items-center gap-1 text-xs text-primary hover:underline">
              Tune &amp; re-classify <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        {validation.total === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <Gauge className="mx-auto h-6 w-6 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium text-muted-foreground">No classifications yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.newCount > 0
                ? `${stats.newCount} message${stats.newCount === 1 ? '' : 's'} ingested — the worker classifies them on its next run.`
                : 'Messages will be classified automatically as they arrive.'}
            </p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Confidence distribution */}
            <div>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">Confidence distribution</span>
                <span className="text-muted-foreground">avg <span className="font-semibold text-foreground tabular-nums">{avgConfidence}</span></span>
              </div>
              <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                {([
                  ['high', conf.high, 'bg-emerald-500'],
                  ['good', conf.good, 'bg-blue-500'],
                  ['medium', conf.medium, 'bg-amber-500'],
                  ['low', conf.low, 'bg-rose-500'],
                ] as const).map(([k, n, cls]) => n > 0 && (
                  <div key={k} className={cls} style={{ width: `${(n / confTotal) * 100}%` }} title={`${k}: ${n}`} />
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-4">
                <span><span className="font-semibold text-emerald-600">{conf.high}</span> high</span>
                <span><span className="font-semibold text-blue-600">{conf.good}</span> good</span>
                <span><span className="font-semibold text-amber-600">{conf.medium}</span> borderline</span>
                <span><span className="font-semibold text-rose-600">{conf.low}</span> low</span>
              </div>
            </div>

            {/* Stage activity */}
            <div>
              <p className="mb-2 text-xs font-medium text-foreground">Resolved by stage</p>
              <div className="space-y-1.5">
                {validation.byStage.map((s) => {
                  const pctOfTotal = validation.total > 0 ? Math.round((s.total / validation.total) * 100) : 0
                  return (
                    <div key={s.stage} className="flex items-center gap-2 text-xs">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT[s.stage] ?? STAGE_DOT.unknown}`} />
                      <span className="w-32 shrink-0 truncate text-muted-foreground">{STAGE_LABEL[s.stage] ?? s.stage}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className={`h-full ${STAGE_DOT[s.stage] ?? STAGE_DOT.unknown}`} style={{ width: `${pctOfTotal}%` }} />
                      </div>
                      <span className="w-8 shrink-0 text-right font-semibold tabular-nums text-foreground">{s.total}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Worklist + breakdowns ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Needs review worklist (spans 2) */}
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Flag className="h-4 w-4 text-muted-foreground" />
              Needs review
            </div>
            <Link href="/intake/inbox?folder=review" className="flex items-center gap-1 text-xs text-primary hover:underline">
              Open all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {pending.data.length === 0 ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Nothing pending — every classified message has been triaged.
            </div>
          ) : (
            <div className="mt-3 divide-y divide-border">
              {pending.data.map((r) => (
                <Link key={r.id} href={`/intake/review/${r.id}`} className="flex items-center gap-3 py-2.5 hover:bg-muted/30">
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${TYPE_CLS[r.suggested_type ?? 'ignore'] ?? TYPE_CLS.ignore}`}>
                    {r.suggested_type ?? '—'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">{r.message?.subject ?? '(no subject)'}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{senderLabel(r.message?.from_address ?? null)}</p>
                  </div>
                  {r.suggested_department && (
                    <span className="hidden shrink-0 text-[11px] capitalize text-muted-foreground sm:inline">{r.suggested_department}</span>
                  )}
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {r.suggested_confidence ?? 0}
                  </span>
                  <span className="hidden w-16 shrink-0 text-right text-[11px] text-muted-foreground sm:inline">
                    {r.created_at ? formatRelativeTime(r.created_at) : ''}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Breakdown by type / department */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Inbox className="h-4 w-4 text-muted-foreground" />
            Breakdown
          </div>
          {validation.total === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">No data yet.</p>
          ) : (
            <div className="mt-3 space-y-4">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">By work type</p>
                <div className="space-y-1">
                  {topTypes.map(([t, n]) => (
                    <Link key={t} href={`/intake/inbox?folder=${t === 'informational' ? 'info' : t}`}
                      className="flex items-center justify-between text-xs hover:text-primary">
                      <span className="capitalize text-muted-foreground">{t}</span>
                      <span className="font-semibold text-foreground tabular-nums">{n}</span>
                    </Link>
                  ))}
                </div>
              </div>
              {topDepts.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">By department</p>
                  <div className="space-y-1">
                    {topDepts.map(([d, n]) => (
                      <div key={d} className="flex items-center justify-between text-xs">
                        <span className="capitalize text-muted-foreground">{d}</span>
                        <span className="font-semibold text-foreground tabular-nums">{n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Recent activity + channel health ──────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent activity (spans 2) */}
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Mail className="h-4 w-4 text-muted-foreground" />
              Recent activity
            </div>
            <Link href="/intake/inbox" className="flex items-center gap-1 text-xs text-primary hover:underline">
              Open inbox <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          {recent.data.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">No messages yet.</p>
          ) : (
            <div className="mt-3 divide-y divide-border">
              {recent.data.map((m) => {
                const href = m.review?.id ? `/intake/review/${m.review.id}` : `/intake/inbox/${m.id}`
                return (
                  <Link key={m.id} href={href} className="flex items-center gap-3 py-2.5 hover:bg-muted/30">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${m.is_read ? 'bg-transparent' : 'bg-primary'}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-xs ${m.is_read ? 'font-medium text-foreground' : 'font-semibold text-foreground'}`}>
                        {m.subject ?? '(no subject)'}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">{senderLabel(m.from_address)}</p>
                    </div>
                    {m.review?.suggested_type && (
                      <span className={`hidden shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize sm:inline ${TYPE_CLS[m.review.suggested_type] ?? TYPE_CLS.ignore}`}>
                        {m.review.suggested_type}
                      </span>
                    )}
                    <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">
                      {m.received_at ? formatRelativeTime(m.received_at) : ''}
                    </span>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Channel health */}
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Radio className="h-4 w-4 text-muted-foreground" />
              Channels
            </div>
            {isAdmin && (
              <Link href="/intake/channels" className="flex items-center gap-1 text-xs text-primary hover:underline">
                Manage <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {channels.map((c) => {
              const meta = c.status === 'active'
                ? { icon: CheckCircle2, cls: 'text-emerald-600', label: c.last_polled_at ? `polled ${formatRelativeTime(c.last_polled_at)}` : 'active' }
                : c.status === 'error'
                ? { icon: AlertTriangle, cls: 'text-rose-600', label: 'error' }
                : { icon: PauseCircle, cls: 'text-muted-foreground', label: 'paused' }
              const Icon = meta.icon
              return (
                <div key={c.id} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2">
                  <Icon className={`h-4 w-4 shrink-0 ${meta.cls}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">{c.name}</p>
                    <p className="truncate text-[11px] capitalize text-muted-foreground">{c.type} · {meta.label}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
