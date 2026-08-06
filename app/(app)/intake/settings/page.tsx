import { redirect } from 'next/navigation'
import { Settings as SettingsIcon, Info, BarChart3, Layers, Zap } from 'lucide-react'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createClient } from '@/lib/supabase/server'
import { getIntakeValidationStats } from '@/lib/queries/intake'
import { PageHeader } from '@/components/ui/PageHeader'
import { ReclassifyButton } from './ReclassifyButton'

const ADMIN_ROLES = ['admin', 'platform_owner']

const CONF_LABEL: Record<string, string> = {
  low: '0 – 39  (needs review)',
  medium: '40 – 69  (borderline)',
  good: '70 – 89  (confident)',
  high: '90 – 100  (auto-accept)',
}
const CONF_CLS: Record<string, string> = {
  low: 'bg-rose-50 text-rose-700',
  medium: 'bg-amber-50 text-amber-700',
  good: 'bg-blue-50 text-blue-700',
  high: 'bg-emerald-50 text-emerald-700',
}

const STAGE_LABEL: Record<string, string> = {
  rule: 'Stage 1 · Rules',
  local_model: 'Stage 2 · Model',
  premium_ai: 'Stage 3 · Premium AI',
  unknown: 'Unclassified',
}

function fmtCost(microcents: number): string {
  if (!microcents) return 'free'
  const usd = microcents * 1e-8
  if (usd < 0.01) return `<$0.01`
  return `$${usd.toFixed(2)}`
}

export default async function IntakeSettingsPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!ADMIN_ROLES.includes(profile.role)) redirect('/intake')

  // These three reads are independent — fan them out instead of awaiting in
  // series so the admin page's TTFB is one round-trip, not three.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = (await createClient()) as unknown as { from: (t: string) => any }
  const [stats, latestRuleRes, pipelineCfgRes] = await Promise.all([
    getIntakeValidationStats(),
    // Show the version the worker ACTUALLY stamped on its latest rule-stage run,
    // not a hardcoded literal — so this reflects the engine that's really live.
    sb.from('intake_classifications')
      .select('model_version')
      .eq('provider', 'rule_engine')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Stage 2 config lives in Railway env vars, not Vercel — read the pipeline config
    // that the worker upserts on every backfill run (real provider + model stamped in).
    sb.from('intake_pipeline_config')
      .select('config')
      .eq('org_id', profile.org_id)
      .maybeSingle(),
  ])

  const ruleVersion: string = latestRuleRes.data?.model_version ?? 'ruleset — pending first run'

  const pipelineCfg = pipelineCfgRes.data
  type StageCfg = { stage: string; provider?: string; model_version?: string; enabled?: boolean }
  const pipelineStages: StageCfg[] = (pipelineCfg?.config as { stages?: StageCfg[] } | null)?.stages ?? []
  const localModelStage = pipelineStages.find(
    (s) => s.stage === 'local_model' && s.enabled && s.provider && s.provider !== 'local_model' && s.provider !== 'qwen2.5',
  )
  const hasLlmKey = !!localModelStage
  const llmProvider = localModelStage?.provider ?? 'groq'
  const llmModel = localModelStage?.model_version ?? 'unknown'

  return (
    <div className="space-y-4">
      <PageHeader
        title="Intake Settings"
        description="Module defaults, reviewer routing, and retention."
        breadcrumbs={[{ label: 'Intake', href: '/intake' }, { label: 'Settings' }]}
      />

      {/* ── Overview KPIs ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Messages ingested</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{stats.totalMessages}</p>
          <p className="text-[11px] text-muted-foreground">total received</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reviews created</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{stats.total}</p>
          <p className="text-[11px] text-muted-foreground">classified</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Avg confidence</p>
          <p className={`mt-1 text-2xl font-bold ${
            stats.total === 0 ? 'text-muted-foreground' :
            stats.byConfidence.high + stats.byConfidence.good > stats.total / 2 ? 'text-emerald-600' : 'text-amber-600'
          }`}>
            {stats.total > 0
              ? Math.round(stats.byStage.reduce((s, x) => s + x.avgConfidence * x.total, 0) / stats.total)
              : '—'}
          </p>
          <p className="text-[11px] text-muted-foreground">across all stages</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Override rate</p>
          <p className={`mt-1 text-2xl font-bold ${
            stats.reviewed === 0 ? 'text-muted-foreground' :
            stats.overrideRate > 30 ? 'text-amber-600' : 'text-emerald-600'
          }`}>
            {stats.reviewed > 0 ? `${stats.overrideRate}%` : '—'}
          </p>
          <p className="text-[11px] text-muted-foreground">{stats.reviewed} reviewed</p>
        </div>
      </div>

      {/* ── Pipeline stages ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Layers className="h-4 w-4 text-muted-foreground" />
          Classification pipeline
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {/* Stage 1 — always active */}
          <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div>
              <p className="text-xs font-semibold text-emerald-800">Stage 1 · Rules</p>
              <p className="text-[11px] text-emerald-700">Deterministic keyword engine · Always active</p>
              <p className="mt-0.5 text-[10px] text-emerald-600">{ruleVersion}</p>
            </div>
          </div>
          {/* Stage 2 — LLM */}
          <div className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
            hasLlmKey ? 'border-indigo-200 bg-indigo-50' : 'border-border bg-muted/30'
          }`}>
            <Zap className={`mt-0.5 h-4 w-4 shrink-0 ${hasLlmKey ? 'text-indigo-600' : 'text-muted-foreground'}`} />
            <div>
              <p className={`text-xs font-semibold ${hasLlmKey ? 'text-indigo-800' : 'text-muted-foreground'}`}>
                Stage 2 · Model
              </p>
              {hasLlmKey ? (
                <>
                  <p className="text-[11px] text-indigo-700">{llmProvider} · {llmModel}</p>
                  <p className="mt-0.5 text-[10px] text-indigo-600">Active — escalates low-confidence mail</p>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-muted-foreground">Not configured</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">Set INTAKE_LLM_API_KEY to enable</p>
                </>
              )}
            </div>
          </div>
          {/* Stage 3 — future */}
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <Zap className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
            <div>
              <p className="text-xs font-semibold text-muted-foreground">Stage 3 · Premium AI</p>
              <p className="text-[11px] text-muted-foreground">GPT-4o / Claude — coming soon</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">Highest accuracy, per-message cost</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Classification Validation ─────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          Classification validation
          {stats.total > 0 && <span className="ml-1 text-muted-foreground font-normal">— {stats.total} messages</span>}
        </div>

        {stats.total === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <BarChart3 className="mx-auto h-7 w-7 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium text-muted-foreground">No classification data yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.totalMessages > 0
                ? `${stats.totalMessages} messages ingested — run Re-classify below to analyse them.`
                : 'Messages will appear here once your intake channel starts receiving mail.'}
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(['high', 'good', 'medium', 'low'] as const).map((k) => (
                <div key={k} className={`rounded-lg px-3 py-2 ${CONF_CLS[k]}`}>
                  <p className="text-[11px] font-medium opacity-80">{CONF_LABEL[k]}</p>
                  <p className="mt-0.5 text-xl font-bold">{stats.byConfidence[k]}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">By work type</p>
                <div className="space-y-1">
                  {Object.entries(stats.byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                    <div key={t} className="flex items-center justify-between text-xs">
                      <span className="capitalize text-muted-foreground">{t}</span>
                      <span className="font-semibold text-foreground">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">By department</p>
                <div className="space-y-1">
                  {Object.entries(stats.byDepartment).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([d, n]) => (
                    <div key={d} className="flex items-center justify-between text-xs">
                      <span className="capitalize text-muted-foreground">{d}</span>
                      <span className="font-semibold text-foreground">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {stats.reviewed > 0 && (
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-xs">
                <div>
                  <span className="font-semibold text-foreground">{stats.reviewed}</span>
                  <span className="ml-1 text-muted-foreground">reviewed</span>
                </div>
                <div className="text-muted-foreground">·</div>
                <div>
                  <span className="font-semibold text-foreground">{stats.overrides}</span>
                  <span className="ml-1 text-muted-foreground">overridden</span>
                </div>
                <div className="text-muted-foreground">·</div>
                <div>
                  <span className={`font-semibold ${stats.overrideRate > 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {stats.overrideRate}%
                  </span>
                  <span className="ml-1 text-muted-foreground">override rate</span>
                </div>
              </div>
            )}

            {stats.byStage.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Accuracy by classifier stage
                </p>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Stage</th>
                        <th className="px-3 py-2 text-right font-medium">Final picks</th>
                        <th className="px-3 py-2 text-right font-medium">Reviewed</th>
                        <th className="px-3 py-2 text-right font-medium">Avg conf.</th>
                        <th className="px-3 py-2 text-right font-medium">Override rate</th>
                        <th className="px-3 py-2 text-right font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byStage.map((s) => (
                        <tr key={s.stage} className="border-t border-border">
                          <td className="px-3 py-2">
                            <span className="font-semibold text-foreground">{STAGE_LABEL[s.stage] ?? s.stage}</span>
                            {s.provider && <span className="ml-1.5 text-muted-foreground">{s.provider}</span>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-foreground">{s.total}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{s.reviewed}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{s.avgConfidence}</td>
                          <td className="px-3 py-2 text-right">
                            {s.reviewed > 0 ? (
                              <span className={`font-semibold tabular-nums ${s.overrideRate > 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                {s.overrideRate}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtCost(s.totalCostMicrocents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Lower override rate = more trustworthy. Compare Stage 2 (model) against the rule engine
                  to decide whether escalation is paying off.
                </p>
              </div>
            )}

            {stats.sampleLow.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Low-confidence sample (needs manual review)
                </p>
                <div className="space-y-1.5">
                  {stats.sampleLow.map((s) => (
                    <a key={s.id} href={`/intake/review/${s.id}`}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted/30">
                      <span className="truncate text-foreground">{s.subject ?? '(no subject)'} — {s.from_address ?? '—'}</span>
                      <span className="ml-2 shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 border border-rose-200">
                        {s.suggested_confidence ?? 0}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Module configuration ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <SettingsIcon className="h-4 w-4 text-muted-foreground" />
          Module configuration
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
          <p className="text-xs text-blue-800">
            Reviewer routing, SLA defaults, and message retention will be configurable here as
            later phases ship (Rules Engine, Learning Center). For now, configure inbound sources
            under <span className="font-semibold">Channels</span>.
          </p>
        </div>
      </div>

      {/* ── Re-classify ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5">
        <ReclassifyButton />
      </div>
    </div>
  )
}
