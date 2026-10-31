'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { saveBuiltInCategories } from '@/lib/actions/admin/programs'
import { updateMastersNow } from '@/lib/actions/admin/masters'
import { setPoApprover } from '@/lib/actions/admin/vendors'
import { SourceCard, TemplateCard, Card } from '@/app/(app)/admin/masters/MastersClient'
import type { BuiltInEditorData, BuiltInKind } from '@/lib/programs/builtin'

// The built-in AC / Genset line on the Vendor Programs screens. The sheet and the mail wording are the same parts the Sheet Masters page used; the categories are the
// "send to the AC / Genset OEM" switch of Admin > Categories. Nothing about how tickets are handled changes.

type Msg = { ok: boolean; text: string } | null
const Note = ({ m }: { m: Msg }) => (m ? <span role={m.ok ? 'status' : 'alert'} className={cn('text-xs', m.ok ? 'text-emerald-700' : 'text-red-600')}>{m.text}</span> : null)
const btn = 'rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50'

export function BuiltInClient({ data, spec, rowType }: { data: BuiltInEditorData; spec: { kind: BuiltInKind; title: string; hint: string }; rowType: 'machine' | 'store' }) {
  const router = useRouter()
  const { readiness, categories, source, issues, template, connected, staff, approverId } = data
  const [approver, setApprover] = useState(approverId)
  const [apprMsg, setApprMsg] = useState<Msg>(null)
  const [pending, start] = useTransition()
  const [picked, setPicked] = useState<string[]>(categories.filter((c) => c.selected).map((c) => c.id))
  const [catMsg, setCatMsg] = useState<Msg>(null)
  const [updMsg, setUpdMsg] = useState<Msg>(null)
  const on = categories.some((c) => c.selected)
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.length - errors

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Check my set-up</h2>
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', on ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground')}>{on ? 'In use' : 'No category yet'}</span>
        </div>
        <ul className="space-y-1.5">
          {readiness.items.map((i) => (
            <li key={i.key} className="flex items-start gap-2 text-sm">
              {i.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="done" /> : i.blocking ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-label="missing" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-label="to look at" />}
              <span className={i.ok ? 'text-foreground' : i.blocking ? 'text-red-700' : 'text-amber-800'}>{i.text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          {rowType === 'machine' ? 'One row of the sheet is one machine (the requester picks the AC in the ticket form).' : 'One row of the sheet is one genset; a store with several gensets gets one mail that lists them all.'}
        </p>
      </section>

      <Card title="Categories on the old setting" right={<Link href="/admin/programs" className="text-[11px] text-muted-foreground underline">Admin &gt; Vendor Programs</Link>}>
        {categories.some((c) => c.selected) ? (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              These categories still send their tickets with the OLD {spec.kind === 'ac' ? 'AC' : 'Genset'} OEM setting. That setting has been retired: move each category into the {spec.kind === 'ac' ? 'AC' : 'Genset'} Vendor Program
              (card &quot;Move categories from the old AC / Genset setting&quot; on its screen), or untick it here to take it off the old setting. A category can no longer be put on the old setting.
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {categories.filter((c) => c.selected).map((c) => (
                <label key={c.id} className="flex items-start gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                  <span className="block">{c.name}</span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button type="button" disabled={pending} className={btn} onClick={() => start(async () => { const r = await saveBuiltInCategories(spec.kind, picked); setCatMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' }); if (!r.error) router.refresh() })}>Save categories</button>
              <Note m={catMsg} />
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            No category uses the old setting any more. The tickets of {spec.kind === 'ac' ? 'AC' : 'Genset'} categories are mailed by the {spec.kind === 'ac' ? 'AC' : 'Genset'} Vendor Program (Admin &gt; Vendor Programs): its sheet, its mail wording and its categories are set there.
          </p>
        )}
        {spec.kind === 'ac' && <p className="mt-3 text-[11px] text-muted-foreground">Keep &quot;Route to OEM&quot; ticked on the AC service (Admin &gt; Services): the reports use it to recognise AC tickets.</p>}
      </Card>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h2 className="text-sm font-semibold text-foreground">Google Sheet</h2>
          <div className="flex items-center gap-2">
            <Note m={updMsg} />
            <button
              type="button"
              disabled={pending || !connected}
              title={!connected ? 'Connect Google Sheets first (Admin > Sheet Masters)' : undefined}
              className={btn}
              onClick={() => start(async () => { setUpdMsg(null); const r = await updateMastersNow(); setUpdMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.summary ?? 'Updated.' }); router.refresh() })}
            >
              Update from sheets now
            </button>
          </div>
        </div>
        <SourceCard source={source} spec={spec} issueCount={{ errors, warnings }} />
        {!connected && <p className="px-1 text-xs text-amber-700">Google Sheets is not connected. Connect it in <Link href="/admin/masters" className="underline">Admin &gt; Sheet Masters</Link>.</p>}
      </div>

      <TemplateCard t={template} />

      {spec.kind === 'ac' && (
        <Card title="Default PO approver of AC">
          <p className="mb-2 text-xs text-muted-foreground">When a vendor sends a quote, it goes to the approvers named in the AC sheet column Quote Approver Mail To (any one decides). If the sheet names nobody for an AC, it goes to the person chosen here. This is the default of the AC line only; every Vendor Program has its own on its own screen. (Genset has no quote or PO flow.)</p>
          <div className="flex flex-wrap items-center gap-3">
            <select aria-label="Default PO approver of AC" value={approver} disabled={pending} onChange={(e) => { const v = e.target.value; setApprover(v); start(async () => { const r = await setPoApprover(v); setApprMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' }); if (!r.error) router.refresh() }) }} className="h-9 min-w-[14rem] rounded-lg border border-border bg-background px-3 text-sm">
              {!approver && <option value="">Not set - choose a person</option>}
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            <Note m={apprMsg} />
          </div>
        </Card>
      )}

      <Card title="What happens to the ticket">
        <p className="text-sm text-muted-foreground">
          The OEM is mailed when the ticket is raised and the ticket moves to In Progress by itself; the conversation shows who it was sent to.
          {spec.kind === 'ac' ? ' The AC picker in the ticket form, the vendor portal, quote and PO approval and the AC PMS tickets follow the AC settings and the AC sheet columns Ticket Mail To, PO Mail To and Quote Approver Mail To.' : ' Genset tickets are mailed only; there is no vendor portal for Genset.'}
        </p>
      </Card>

      <Card title={`Problems found in the sheet (${issues.length})`}>
        {issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">No problems found in the sheet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {issues.map((i, n) => (
              <li key={n} className="flex items-start gap-2 py-2">
                {i.severity === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                <div className="min-w-0">
                  <p className="text-foreground">{i.message}</p>
                  {i.store_code && <p className="text-[11px] text-muted-foreground">Store {i.store_code}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
