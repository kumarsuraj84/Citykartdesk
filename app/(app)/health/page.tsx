import Link from 'next/link'
import { PageHeader } from '@/components/ui/PageHeader'
import { formatDateTime } from '@/lib/utils'
import { CHECKS, INCIDENT_AFTER, labelOf, METRICS, PAGE_LIMITS, SERVER_LIMITS, STALE_AFTER_MINUTES } from '@/lib/health/catalog'
import { lcpRating, RUM_GOOD, RUM_POOR, VIEWPORT_LABEL, type ViewportClass } from '@/lib/health/rum'
import { humanMinutes, uptimeText } from '@/lib/health/evaluate'
import { getCheckSeries, getHealthOverview, getMetricSeries, getPerf, getRum, type CheckState } from '@/lib/health/queries'
import { DayStrip, Trend } from './_components/Charts'
import { CheckToggles } from './_components/CheckToggles'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Health & Performance' }

const RANGES = { '24h': { label: 'Last 24 hours', hours: 24 }, '7d': { label: 'Last 7 days', hours: 24 * 7 }, '30d': { label: 'Last 30 days', hours: 24 * 30 } } as const
type RangeKey = keyof typeof RANGES
const fmt = (x: number) => x.toLocaleString('en-IN')

const STATUS_TEXT = {
  healthy: { text: 'Everything is working', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' },
  degraded: { text: 'Working, but something needs attention', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300' },
  down: { text: 'Something important is DOWN', cls: 'border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-300' },
  unknown: { text: 'No monitoring data yet', cls: 'border-border bg-muted text-muted-foreground' },
} as const

const LEVEL = {
  good: { dot: 'bg-emerald-500', text: 'Good' },
  down: { dot: 'bg-red-500', text: 'Down' },
  nodata: { dot: 'bg-zinc-400', text: 'No recent data' },
} as const

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  )
}

function CheckCard({ c, nowMs }: { c: CheckState; nowMs: number }) {
  const lv = c.notApplicable ? { dot: 'bg-zinc-300', text: 'Not in use' } : LEVEL[c.level]
  const age = c.lastAt ? (nowMs - new Date(c.lastAt).getTime()) / 60_000 : null
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${lv.dot}`} aria-hidden />{c.label}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{c.good}</p>
        </div>
        <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground">{lv.text}</span>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
        {([['24 h', c.uptime.d1], ['7 days', c.uptime.d7], ['30 days', c.uptime.d30]] as const).map(([k, v]) => (
          <div key={k} className="rounded-md bg-muted/50 px-1 py-1">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Uptime {k}</dt>
            <dd className="text-sm font-semibold tabular-nums text-foreground">{uptimeText(v)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2"><DayStrip days={c.days} /></div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {c.notApplicable ? 'Nothing to check right now (it is not set up or not active). It starts showing here by itself when it is.' : c.lastAt ? <>Last check {age !== null && age < 1 ? 'just now' : `${humanMinutes(age ?? 0)} ago`}{c.lastMs !== null ? <> · answered in <span className="font-medium text-foreground">{fmt(c.lastMs)} ms</span></> : null}</> : 'No check recorded in the last 15 minutes.'}
        {c.detail && c.level !== 'good' && <span className="mt-0.5 block text-foreground">{c.detail}</span>}
        {c.detail && c.level === 'good' && <span className="block">{c.detail}</span>}
      </p>
      {c.openSince && <p className="mt-1 text-[11px] font-semibold text-red-700 dark:text-red-400">Outage since {formatDateTime(c.openSince)} ({humanMinutes((nowMs - new Date(c.openSince).getTime()) / 60_000)})</p>}
    </div>
  )
}

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ range?: string; check?: string }> }) {
  const sp = await searchParams
  const range = (sp.range && sp.range in RANGES ? sp.range : '24h') as RangeKey
  const hours = RANGES[range].hours
  const selected = CHECKS.find((c) => c.key === sp.check)?.key ?? 'app'

  const [overview, perf, series, metricSeries, rum] = await Promise.all([getHealthOverview(), getPerf(hours), getCheckSeries(selected, hours), Promise.all(METRICS.map((m) => getMetricSeries(m.key, hours))), getRum(hours)])
  const nowMs = overview.nowMs
  const st = STATUS_TEXT[overview.status]
  const lastAge = overview.lastSampleAt ? (nowMs - new Date(overview.lastSampleAt).getTime()) / 60_000 : null
  const probeStopped = lastAge === null || lastAge > STALE_AFTER_MINUTES
  const enabledChecks = overview.checks.filter((c) => c.enabled)
  const core = enabledChecks.filter((c) => c.group === 'core')
  const servers = enabledChecks.filter((c) => c.group === 'server')
  const syncs = enabledChecks.filter((c) => c.group === 'sync')

  const totalReq = perf.series.reduce((a, p) => a + p.n, 0)
  const wAvg = (k: 'p50' | 'p95') => (totalReq ? Math.round(perf.series.reduce((a, p) => a + p[k] * p.n, 0) / totalReq) : null)
  const errs = perf.series.reduce((a, p) => a + p.errors5xx, 0)
  const slowest = perf.series.reduce((a, p) => Math.max(a, p.max), 0)

  return (
    <>
      <PageHeader
        title="Health & Performance"
        description="Is CK Desk up, how fast is it, and are the syncs on time. Visible to platform owners only."
        actions={
          <nav className="flex gap-1 text-xs" aria-label="Period">
            {(Object.keys(RANGES) as RangeKey[]).map((k) => (
              <Link key={k} href={`/health?range=${k}&check=${selected}`} prefetch={false} className={`rounded-md border px-2.5 py-1 ${k === range ? 'border-primary bg-primary/10 font-semibold text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>{RANGES[k].label}</Link>
            ))}
          </nav>
        }
      />

      <div className={`rounded-lg border px-4 py-3 ${st.cls}`} role="status">
        <p className="text-base font-bold">{st.text}</p>
        <p className="mt-0.5 text-xs opacity-90">
          {probeStopped
            ? 'The one-minute check on the app server has not reported for over 5 minutes (or has never run). Until it does, the app, data service, gateway and file storage show "No recent data".'
            : `Checks are running: last report ${humanMinutes(lastAge ?? 0)} ago. An outage is raised after 3 failed checks in a row and shown here and as a red bar on top of your screen.`}
        </p>
      </div>

      <section aria-labelledby="core-h" className="space-y-2">
        <h2 id="core-h" className="text-sm font-semibold text-foreground">The system</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{core.map((c) => <CheckCard key={c.key} c={c} nowMs={nowMs} />)}</div>
      </section>

      {servers.length > 0 && (
        <section aria-labelledby="srv-h" className="space-y-2">
          <h2 id="srv-h" className="text-sm font-semibold text-foreground">The servers</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{servers.map((c) => <CheckCard key={c.key} c={c} nowMs={nowMs} />)}</div>
          <div className="grid gap-3 lg:grid-cols-2">
            {METRICS.map((m, i) => (
              <div key={m.key} className="rounded-lg border border-border bg-card p-3">
                <p className="mb-1 text-xs font-semibold text-foreground">{m.label} — {RANGES[range].label.toLowerCase()}</p>
                <Trend points={metricSeries[i].map((p) => ({ at: p.at, a: p.avg, b: m.worst === 'max' ? p.max : p.min }))} aLabel="Average" bLabel={m.worst === 'max' ? 'Highest' : 'Lowest'} unit={m.unit} fixedMax={m.max} emptyText="Not enough data for a chart yet." />
              </div>
            ))}
          </div>
        </section>
      )}

      {syncs.length > 0 && (
        <section aria-labelledby="sync-h" className="space-y-2">
          <h2 id="sync-h" className="text-sm font-semibold text-foreground">Syncs (data coming in)</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{syncs.map((c) => <CheckCard key={c.key} c={c} nowMs={nowMs} />)}</div>
        </section>
      )}

      <section aria-labelledby="perf-h" className="space-y-2">
        <h2 id="perf-h" className="text-sm font-semibold text-foreground">How fast are the pages — {RANGES[range].label.toLowerCase()}</h2>
        {totalReq === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No page-speed figures stored yet. The app writes them every 10 minutes once this release (and its database update) is live.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Page requests" value={fmt(totalReq)} />
              <Tile label="Typical page time" value={`${fmt(wAvg('p50') ?? 0)} ms`} note="half of the requests were faster" />
              <Tile label="Slow page time (95th)" value={`${fmt(wAvg('p95') ?? 0)} ms`} note="19 of 20 requests were faster" />
              <Tile label="Failed requests (5xx)" value={fmt(errs)} note={`slowest single request ${fmt(slowest)} ms`} />
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <Trend points={perf.series.map((p) => ({ at: p.at, a: p.p50, b: p.p95 }))} aLabel="Typical" bLabel="Slow (95th)" emptyText="Not enough data for a trend yet." />
            </div>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-xs">
                <caption className="px-3 py-2 text-left text-sm font-semibold text-foreground">Slowest pages (asked at least 5 times)</caption>
                <thead><tr className="border-t border-border text-left text-muted-foreground"><th className="px-3 py-1.5 font-medium">Page</th><th className="px-3 py-1.5 text-right font-medium">Requests</th><th className="px-3 py-1.5 text-right font-medium">Typical ms</th><th className="px-3 py-1.5 text-right font-medium">Slow (95th) ms</th><th className="px-3 py-1.5 text-right font-medium">Slowest ms</th><th className="px-3 py-1.5 text-right font-medium">Failed</th></tr></thead>
                <tbody>
                  {perf.slowest.map((r) => (
                    <tr key={`${r.method} ${r.route}`} className="border-t border-border">
                      <td className="max-w-[28rem] truncate px-3 py-1.5 font-mono text-foreground" title={`${r.method} ${r.route}`}><span className="text-muted-foreground">{r.method}</span> {r.route}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.requests)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.p50)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${r.p95 >= 1500 ? 'font-semibold text-red-700 dark:text-red-400' : ''}`}>{fmt(r.p95)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.slowest)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.errors5xx ? fmt(r.errors5xx) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="rum-h" className="space-y-2">
        <h2 id="rum-h" className="text-sm font-semibold text-foreground">What people really experience — {RANGES[range].label.toLowerCase()}</h2>
        <p className="text-xs text-muted-foreground">Measured in the browsers of people who are signed in (no name or e-mail is kept). “Largest paint” is the time until the main content of a page is on screen: up to {RUM_GOOD.lcpMs / 1000} s is good, over {RUM_POOR.lcpMs / 1000} s is poor.</p>
        {!rum.summary || (rum.summary.loads === 0 && rum.summary.views === 0) ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No browser reports yet. They arrive as people use CK Desk after this release (and its database update) is live.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Full page loads measured" value={fmt(rum.summary.loads)} note={`${fmt(rum.summary.views)} screens checked for fit`} />
              <Tile label="Main content on screen (75%)" value={rum.summary.lcpP75 === null ? '—' : `${(rum.summary.lcpP75 / 1000).toFixed(1)} s`} note={`typical ${rum.summary.lcpP50 === null ? '—' : (rum.summary.lcpP50 / 1000).toFixed(1) + ' s'} · rating: ${lcpRating(rum.summary.lcpP75) ?? '—'}`} />
              <Tile label="Loads rated poor" value={rum.summary.loads ? `${Math.round((rum.summary.poorLcp / rum.summary.loads) * 100)}%` : '—'} note={`${fmt(rum.summary.poorLcp)} took over ${RUM_POOR.lcpMs / 1000} s`} />
              <Tile label="Screens with content cut off" value={rum.summary.views ? `${Math.round((rum.summary.cutOffViews / rum.summary.views) * 100)}%` : '—'} note={`${fmt(rum.summary.cutOffViews)} of ${fmt(rum.summary.views)} screens`} />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-xs">
                  <caption className="px-3 py-2 text-left text-sm font-semibold text-foreground">Slowest screens for people (at least 3 loads)</caption>
                  <thead><tr className="border-t border-border text-left text-muted-foreground"><th className="px-3 py-1.5 font-medium">Screen</th><th className="px-3 py-1.5 text-right font-medium">Loads</th><th className="px-3 py-1.5 text-right font-medium">Content on screen</th><th className="px-3 py-1.5 text-right font-medium">Full load (95th)</th></tr></thead>
                  <tbody>
                    {rum.routes.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-muted-foreground">Not enough loads yet.</td></tr>}
                    {rum.routes.map((r) => (
                      <tr key={r.route} className="border-t border-border">
                        <td className="max-w-[16rem] truncate px-3 py-1.5 font-mono text-foreground" title={r.route}>{r.route}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmt(r.loads)}</td>
                        <td className={`px-3 py-1.5 text-right tabular-nums ${(r.lcpP75 ?? 0) > RUM_POOR.lcpMs ? 'font-semibold text-red-700 dark:text-red-400' : ''}`}>{r.lcpP75 === null ? '—' : `${(r.lcpP75 / 1000).toFixed(1)} s`}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.loadP95 === null ? '—' : `${(r.loadP95 / 1000).toFixed(1)} s`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-xs">
                  <caption className="px-3 py-2 text-left text-sm font-semibold text-foreground">Screen sizes in use</caption>
                  <thead><tr className="border-t border-border text-left text-muted-foreground"><th className="px-3 py-1.5 font-medium">Window</th><th className="px-3 py-1.5 text-right font-medium">Screens viewed</th><th className="px-3 py-1.5 text-right font-medium">Content cut off</th><th className="px-3 py-1.5 text-right font-medium">Content on screen (75%)</th></tr></thead>
                  <tbody>
                    {rum.viewports.map((v) => (
                      <tr key={v.vclass} className="border-t border-border">
                        <td className="px-3 py-1.5 text-foreground">{VIEWPORT_LABEL[v.vclass as ViewportClass] ?? v.vclass}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{fmt(v.views)}</td>
                        <td className={`px-3 py-1.5 text-right tabular-nums ${v.cutOffViews > 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : ''}`}>{v.views ? `${fmt(v.cutOffViews)} (${Math.round((v.cutOffViews / v.views) * 100)}%)` : '—'}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{v.lcpP75 === null ? '—' : `${(v.lcpP75 / 1000).toFixed(1)} s`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-xs">
                <caption className="px-3 py-2 text-left text-sm font-semibold text-foreground">Screens where content ran past the page (cut off or needing a sideways scroll)</caption>
                <thead><tr className="border-t border-border text-left text-muted-foreground"><th className="px-3 py-1.5 font-medium">Screen</th><th className="px-3 py-1.5 font-medium">Window</th><th className="px-3 py-1.5 text-right font-medium">Times seen</th><th className="px-3 py-1.5 text-right font-medium">Of views</th><th className="px-3 py-1.5 text-right font-medium">Most past the edge</th></tr></thead>
                <tbody>
                  {rum.issues.length === 0 && <tr><td colSpan={5} className="px-3 py-3 text-muted-foreground">No screen was reported as cut off in this period.</td></tr>}
                  {rum.issues.map((i) => (
                    <tr key={`${i.route}|${i.vclass}`} className="border-t border-border">
                      <td className="max-w-[24rem] truncate px-3 py-1.5 font-mono text-foreground" title={i.route}>{i.route}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{VIEWPORT_LABEL[i.vclass as ViewportClass] ?? i.vclass} (about {fmt(i.avgViewportW)} px)</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(i.cutOffViews)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{Math.round((i.cutOffViews / i.views) * 100)}%</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmt(i.maxOverflowPx)} px</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="resp-h" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="resp-h" className="text-sm font-semibold text-foreground">How quickly a check answers</h2>
          <nav className="flex flex-wrap gap-1 text-xs" aria-label="Check">
            {enabledChecks.map((c) => (
              <Link key={c.key} href={`/health?range=${range}&check=${c.key}`} prefetch={false} className={`rounded-md border px-2 py-0.5 ${c.key === selected ? 'border-primary bg-primary/10 font-semibold text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>{c.label}</Link>
            ))}
          </nav>
        </div>
        <div className="rounded-lg border border-border bg-card p-3">
          <Trend points={series.map((p) => ({ at: p.at, a: p.p50, b: p.p95 }))} aLabel="Typical" bLabel="Slow (95th)" emptyText={`No answers recorded yet for “${labelOf(selected)}” in this period.`} />
        </div>
      </section>

      <section aria-labelledby="inc-h" className="space-y-2">
        <h2 id="inc-h" className="text-sm font-semibold text-foreground">Outages</h2>
        {overview.incidents.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No outage has been recorded.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground"><th className="px-3 py-1.5 font-medium">What</th><th className="px-3 py-1.5 font-medium">Started</th><th className="px-3 py-1.5 font-medium">Lasted</th><th className="px-3 py-1.5 font-medium">What was seen</th></tr></thead>
              <tbody>
                {overview.incidents.map((i) => (
                  <tr key={i.id} className="border-t border-border align-top">
                    <td className="px-3 py-1.5 font-medium text-foreground">{labelOf(i.checkKey)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{formatDateTime(i.startedAt)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{i.endedAt ? humanMinutes((new Date(i.endedAt).getTime() - new Date(i.startedAt).getTime()) / 60_000) : <span className="font-semibold text-red-700 dark:text-red-400">still down ({humanMinutes((nowMs - new Date(i.startedAt).getTime()) / 60_000)})</span>}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{i.detail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="alr-h" className="space-y-2">
        <h2 id="alr-h" className="text-sm font-semibold text-foreground">When an alert is raised</h2>
        <div className="rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
          <p>An alert is raised when a check fails {INCIDENT_AFTER} times in a row (one lost answer is not an outage). It shows as a red bar on top of every screen and as a notification in your bell, and again when the check recovers. Only platform owners get it, on the portal only (no e-mail or message yet).</p>
          <ul className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {enabledChecks.map((c) => <li key={c.key}><span className="font-medium text-foreground">{c.label}:</span> {c.good}</li>)}
          </ul>
          <p className="mt-2">Limits: CPU {SERVER_LIMITS.cpuPct}%, memory {SERVER_LIMITS.memoryPct}%, free disk {SERVER_LIMITS.diskFreePct}% / {SERVER_LIMITS.diskFreeGb} GB, database connections {SERVER_LIMITS.dbConnectionsPct}%, a query over {SERVER_LIMITS.dbQuerySeconds / 60} min, slow pages {PAGE_LIMITS.p95Ms / 1000} s or {PAGE_LIMITS.errorPct}% failing (judged over the last {PAGE_LIMITS.lookbackMinutes} min).</p>
        </div>
      </section>

      <section aria-labelledby="set-h" className="space-y-2">
        <h2 id="set-h" className="text-sm font-semibold text-foreground">What is monitored</h2>
        <p className="text-xs text-muted-foreground">Switch a check off when it no longer applies (for example the Zoho sync once Zoho is retired). Its history is kept.</p>
        <CheckToggles items={overview.checks.map((c) => ({ key: c.key, label: c.label, enabled: c.enabled, locked: c.key === 'app' }))} />
      </section>
    </>
  )
}
