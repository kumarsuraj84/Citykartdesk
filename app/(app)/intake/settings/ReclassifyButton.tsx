'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw, FlaskConical, CalendarDays, Info } from 'lucide-react'
import {
  reclassifyBacklog, getReclassifyProgress, testStage2,
  type ReclassifyProgress, type TestStage2Result,
} from '@/lib/actions/intake/pipeline'

// Quick ISO date string for "today minus N days" used as default.
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

const POLL_MS = 2500
const STALL_LIMIT = 6 // stop after this many polls with no change (≈15s of stillness)

const STAGE_META: { key: keyof ReclassifyProgress['byStage']; label: string; cls: string }[] = [
  { key: 'rule',        label: 'S1 · Rules', cls: 'text-slate-600' },
  { key: 'local_model', label: 'S2 · Model', cls: 'text-indigo-600' },
  { key: 'premium_ai',  label: 'S3 · Premium', cls: 'text-fuchsia-600' },
]

export function ReclassifyButton() {
  const router = useRouter()
  const [progress, setProgress] = useState<ReclassifyProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestStage2Result | null>(null)
  // Default: classify only the last 60 days. Users can clear this to classify all.
  const [sinceDate, setSinceDate] = useState<string>(daysAgo(60))
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastSig = useRef('')
  const stall = useRef(0)

  const stop = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null }
    setRunning(false)
    router.refresh() // refresh the validation/stage tables once done
  }, [router])

  const poll = useCallback(async () => {
    const p = await getReclassifyProgress()
    setProgress(p)

    // Track the full state (count + stage split + avg confidence), not just the
    // total — a force re-run keeps the count flat while emails move S1 → S2.
    const sig = `${p.classified}|${p.byStage.rule}|${p.byStage.local_model}|${p.byStage.premium_ai}|${p.avgConfidence}|${p.stage2Attempts}`
    if (sig === lastSig.current) stall.current++
    else { stall.current = 0; lastSig.current = sig }

    if (stall.current >= STALL_LIMIT) stop()
  }, [stop])

  // Fetch a snapshot on mount so the current state is visible before running.
  useEffect(() => {
    getReclassifyProgress().then(setProgress).catch(() => {})
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [])

  async function handleClick() {
    // force=true re-runs the pipeline on un-actioned messages so low-confidence
    // ones now escalate to Stage 2 (without it, already-classified mail is skipped).
    const dateParam = sinceDate ? new Date(sinceDate).toISOString() : undefined
    const res = await reclassifyBacklog(true, dateParam)
    if (!res.ok) { toast.error(res.error ?? 'Re-classification failed.'); return }
    const scopeMsg = sinceDate ? ` (from ${sinceDate})` : ' (all messages)'
    toast.success(`Re-classification started${scopeMsg} — tracking progress…`)

    setRunning(true)
    lastSig.current = ''
    stall.current = 0
    await poll()
    if (timer.current) clearInterval(timer.current)
    timer.current = setInterval(poll, POLL_MS)
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await testStage2()
      setTestResult(r)
      if (r.ok) toast.success('Stage 2 responded — model is reachable.')
      else toast.error(r.error ?? 'Stage 2 test failed.')
    } finally {
      setTesting(false)
    }
  }

  const pct = progress && progress.totalMessages > 0
    ? Math.min(100, Math.round((progress.classified / progress.totalMessages) * 100))
    : 0

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Re-classify messages</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Runs the classification pipeline. Scope by date to skip old mail.
          </p>
          {/* Date range picker — aligned with channel sync_from_date */}
          <div className="mt-2 flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <label className="text-xs text-muted-foreground">From</label>
            <input
              type="date"
              value={sinceDate}
              onChange={(e) => setSinceDate(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            />
            <button type="button" onClick={() => setSinceDate('')}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
              All time
            </button>
            {sinceDate && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Info className="h-3 w-3" /> emails before this date will not be classified
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={handleTest}
            disabled={testing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          >
            <FlaskConical className={`h-3.5 w-3.5 ${testing ? 'animate-pulse' : ''}`} />
            {testing ? 'Testing…' : 'Test Stage 2'}
          </button>
          <button
            onClick={handleClick}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-500/30 transition hover:brightness-110 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} />
            {running ? 'Re-classifying…' : 'Re-classify all messages'}
          </button>
        </div>
      </div>

      {/* Stage 2 test result */}
      {testResult && (
        <div className={`mt-4 rounded-lg border px-3 py-3 text-xs ${
          testResult.ok ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'
        }`}>
          {testResult.ok && testResult.result ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-semibold text-emerald-800">
                <span>✓ Stage 2 reachable</span>
                <span className="font-normal text-emerald-700">{testResult.provider} · {testResult.model} · {testResult.latencyMs}ms</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-foreground sm:grid-cols-4">
                <div><span className="text-muted-foreground">Type:</span> <span className="font-semibold capitalize">{testResult.result.suggestedType}</span></div>
                <div><span className="text-muted-foreground">Dept:</span> <span className="font-semibold">{testResult.result.suggestedDepartment ?? '—'}</span></div>
                <div><span className="text-muted-foreground">Priority:</span> <span className="font-semibold capitalize">{testResult.result.suggestedPriority}</span></div>
                <div><span className="text-muted-foreground">Confidence:</span> <span className="font-semibold">{testResult.result.confidence}</span></div>
              </div>
              <p className="text-muted-foreground"><span className="font-medium text-foreground">Rationale:</span> {testResult.result.rationale}</p>
              <p className="text-[11px] text-muted-foreground italic">Sample: “{testResult.sample?.subject}”</p>
            </div>
          ) : (
            <div className="text-rose-800">
              <span className="font-semibold">✗ Test failed:</span> {testResult.error}
            </div>
          )}
        </div>
      )}

      {progress && (
        <div className="mt-4 space-y-3">
          {/* Progress bar */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">
                {progress.classified} / {progress.totalMessages} classified
              </span>
              <span className="tabular-nums text-muted-foreground">{pct}%{running ? ' · live' : ''}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all duration-500 ${running ? 'bg-blue-500' : 'bg-emerald-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Per-stage + confidence counters */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {STAGE_META.map((s) => (
              <div key={s.key} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{s.label}</p>
                <p className={`mt-0.5 text-lg font-bold tabular-nums ${s.cls}`}>{progress.byStage[s.key]}</p>
              </div>
            ))}
            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">Avg confidence</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{progress.avgConfidence}</p>
            </div>
          </div>

          {/* Confidence distribution */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span><span className="font-semibold text-emerald-600">{progress.byConfidence.high}</span> high (90+)</span>
            <span><span className="font-semibold text-blue-600">{progress.byConfidence.good}</span> good (70–89)</span>
            <span><span className="font-semibold text-amber-600">{progress.byConfidence.medium}</span> borderline (40–69)</span>
            <span><span className="font-semibold text-rose-600">{progress.byConfidence.low}</span> low (&lt;40)</span>
          </div>

          {/* Stage 2 escalation funnel — attempts vs wins tells you whether the
              model is being called at all, separately from whether it overrode rules. */}
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="font-semibold text-indigo-700">Stage 2 escalation:</span>{' '}
            <span className="font-semibold text-foreground">{progress.stage2Attempts}</span> escalated to the model ·{' '}
            <span className="font-semibold text-foreground">{progress.byStage.local_model}</span> won over rules
            {progress.stage2Attempts > 0 && progress.byStage.local_model === 0 && (
              <span className="italic"> — the model is running but the rules already agreed</span>
            )}
            {progress.stage2Attempts === 0 && (
              <span className="italic"> — nothing escalated (rules were confident enough)</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
