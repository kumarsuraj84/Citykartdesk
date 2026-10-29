'use client'

import { useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import {
  deleteProgram, resetProgramTemplate, saveProgramBasics, saveProgramCategories, saveProgramSheet, saveProgramTemplate, sendProgramTestMail, setProgramActive, updateProgramNow,
} from '@/lib/actions/admin/programs'
import { allowedFields, DEFAULT_PROGRAM_BODY, PROGRAM_SAMPLE_VALUES } from '@/lib/programs/mail'
import { DEFAULT_HEADINGS, FIELD_LABEL, PROGRAM_FIELDS, type ProgramColumns, type ProgramField } from '@/lib/programs/types'
import type { ProgramEditorData } from '@/lib/programs/admin-data'

const RichEmailEditor = dynamic(() => import('@/components/admin/RichEmailEditor'), {
  ssr: false,
  loading: () => <div className="min-h-[300px] rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground">Loading editor…</div>,
})

type Msg = { ok: boolean; text: string } | null

function Card({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground"><span className="mr-2 inline-grid h-5 w-5 place-items-center rounded-full bg-primary/10 text-[11px] text-primary">{n}</span>{title}</h2>
      {hint && <p className="mb-3 mt-1 text-xs text-muted-foreground">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  )
}

const Note = ({ m }: { m: Msg }) => (m ? <span role={m.ok ? 'status' : 'alert'} className={cn('text-xs', m.ok ? 'text-emerald-700' : 'text-red-600')}>{m.text}</span> : null)
const btn = 'rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50'
const btnPrimary = 'rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50'

export function ProgramEditorClient({ data, subject: subject0, body: body0, customTemplate }: { data: ProgramEditorData; subject: string; body: string; customTemplate: boolean }) {
  const router = useRouter()
  const { program, categories, issues, extraHeadings, readiness } = data
  const [pending, start] = useTransition()

  const [name, setName] = useState(program.name)
  const [rowType, setRowType] = useState(program.row_type)
  const [basicsMsg, setBasicsMsg] = useState<Msg>(null)

  const [picked, setPicked] = useState<string[]>(categories.filter((c) => c.in_program).map((c) => c.id))
  const [catMsg, setCatMsg] = useState<Msg>(null)

  const [link, setLink] = useState(program.spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${program.spreadsheet_id}/edit` : '')
  const [tab, setTab] = useState(program.tab_name ?? '')
  const [columns, setColumns] = useState<ProgramColumns>(program.columns ?? {})
  const [sheetMsg, setSheetMsg] = useState<Msg>(null)

  const [subject, setSubject] = useState(subject0)
  const [body, setBody] = useState(body0)
  const [tplMsg, setTplMsg] = useState<Msg>(null)

  const [activeMsg, setActiveMsg] = useState<Msg>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const run = (fn: () => Promise<void>) => start(async () => { await fn(); router.refresh() })

  return (
    <div className="space-y-4">
      {/* Check my set-up */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Check my set-up</h2>
          <div className="flex items-center gap-2">
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', program.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground')}>{program.is_active ? 'Switched on' : 'Switched off'}</span>
            <button
              type="button"
              disabled={pending || (!program.is_active && !readiness.ready)}
              title={!program.is_active && !readiness.ready ? 'Finish the red items first' : undefined}
              onClick={() => run(async () => { const r = await setProgramActive(program.id, !program.is_active); setActiveMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: program.is_active ? 'Switched off. Tickets are normal tickets again.' : 'Switched on. New tickets of its categories go to the vendor.' }) })}
              className={program.is_active ? btn : btnPrimary}
            >
              {program.is_active ? 'Switch off' : 'Switch on'}
            </button>
          </div>
        </div>
        <ul className="space-y-1.5">
          {readiness.items.map((i) => (
            <li key={i.key} className="flex items-start gap-2 text-sm">
              {i.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="done" /> : i.blocking ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-label="missing" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-label="to look at" />}
              <span className={i.ok ? 'text-foreground' : i.blocking ? 'text-red-700' : 'text-amber-800'}>{i.text}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2"><Note m={activeMsg} /></div>
      </section>

      <Card n={1} title="Name and kind of sheet" hint="One row per store is simplest (like Genset). Choose one row per machine when the requester should be able to tell which machine is faulty (like AC).">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[14rem] flex-1 text-xs font-medium">Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium">One row of the sheet is
            <select value={rowType} onChange={(e) => setRowType(e.target.value as 'store' | 'machine')} className="mt-1 block rounded-lg border border-border bg-background px-3 py-1.5 text-sm">
              <option value="store">one store</option>
              <option value="machine">one machine</option>
            </select>
          </label>
          <button type="button" disabled={pending} className={btn} onClick={() => run(async () => { const r = await saveProgramBasics(program.id, name, rowType); setBasicsMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' }) })}>Save</button>
          <Note m={basicsMsg} />
        </div>
      </Card>

      <Card n={2} title="Categories" hint="Tickets of the ticked categories go to this program's vendor. A category can be in one program only. Categories that already send to the AC or Genset OEM cannot be chosen.">
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <label key={c.id} className={cn('flex items-start gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm', c.blocked && 'opacity-60')}>
              <input type="checkbox" className="mt-0.5" disabled={!!c.blocked} checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
              <span><span className="block">{c.name}</span>{c.blocked && <span className="block text-[11px] text-muted-foreground">{c.blocked}</span>}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" disabled={pending} className={btn} onClick={() => run(async () => { const r = await saveProgramCategories(program.id, picked); setCatMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' }) })}>Save categories</button>
          <Note m={catMsg} />
        </div>
      </Card>

      <Card n={3} title="Google Sheet" hint="The sheet is the master list. CK Desk copies it at 11:00, 15:00 and 19:00 and never changes it. Needed columns: Store Code and Ticket Mail To (and Machine No for one row per machine). Any other column is kept and can be used in the mail.">
        <div className="flex flex-wrap gap-2">
          <input value={link} onChange={(e) => setLink(e.target.value)} aria-label="Google Sheet link" placeholder="Paste the Google Sheet link" className="min-w-[16rem] flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
          <input value={tab} onChange={(e) => setTab(e.target.value)} aria-label="Tab name (optional)" placeholder="Tab name (optional)" className="w-44 rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
        </div>
        <details className="mt-3 rounded-lg border border-border px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-foreground">Does your sheet use different column names? (optional)</summary>
          <p className="my-2 text-xs text-muted-foreground">Leave empty to use the usual names. Type the heading your sheet already uses and nothing in the sheet has to change.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {PROGRAM_FIELDS.map((f) => (
              <label key={f} className="text-xs font-medium">{FIELD_LABEL[f as ProgramField]}
                <input value={columns[f as ProgramField] ?? ''} onChange={(e) => setColumns((c) => ({ ...c, [f]: e.target.value }))} placeholder={DEFAULT_HEADINGS[f as ProgramField][0]} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-normal" />
              </label>
            ))}
          </div>
        </details>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} className={btnPrimary} onClick={() => run(async () => { const r = await saveProgramSheet(program.id, link, tab, columns); setSheetMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved. Press "Update from sheet now" to copy it.' }) })}>Save sheet</button>
          <button type="button" disabled={pending || !program.spreadsheet_id} className={btn} onClick={() => run(async () => { const r = await updateProgramNow(program.id); setSheetMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.summary ?? 'Done.' }) })}>Update from sheet now</button>
          <Note m={sheetMsg} />
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div><dt className="text-muted-foreground">Last checked</dt><dd>{program.last_checked_at ? formatDateTime(program.last_checked_at) : 'not yet'}</dd></div>
          <div><dt className="text-muted-foreground">Last copied</dt><dd>{program.last_applied_at ? formatDateTime(program.last_applied_at) : 'not yet'}</dd></div>
          <div><dt className="text-muted-foreground">Rows read</dt><dd>{program.row_count ?? '-'}</dd></div>
          <div><dt className="text-muted-foreground">Problems found</dt><dd>{issues.filter((i) => i.severity === 'error').length} to fix, {issues.filter((i) => i.severity === 'warning').length} to look at</dd></div>
        </dl>
        {program.last_status === 'error' && program.last_error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{program.last_error} CK Desk keeps working from the last good copy.</p>}
        {issues.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-foreground">See the {issues.length} problem{issues.length === 1 ? '' : 's'} in the sheet</summary>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
              {issues.map((i, k) => <li key={k} className={i.severity === 'error' ? 'text-red-700' : 'text-amber-800'}>{i.message}</li>)}
            </ul>
          </details>
        )}
      </Card>

      <Card n={4} title="The mail to the vendor" hint="Sent once when a ticket is raised. Use the field buttons to put the ticket's details in. The sheet's extra columns are available too.">
        <label className="mb-1 block text-xs font-medium" htmlFor="program-subject">Subject</label>
        <input id="program-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
        <RichEmailEditor label="Message" value={body} onChange={setBody} placeholders={allowedFields(extraHeadings)} sampleValues={PROGRAM_SAMPLE_VALUES} starterHtml={DEFAULT_PROGRAM_BODY} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} className={btnPrimary} onClick={() => run(async () => { const r = await saveProgramTemplate(program.id, subject, body); setTplMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' }) })}>Save the mail</button>
          <button type="button" disabled={pending} className={btn} onClick={() => run(async () => { const r = await sendProgramTestMail(program.id); setTplMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: `A test mail was sent to ${r.sentTo} only.` }) })}>Send a test to me</button>
          {customTemplate && <button type="button" disabled={pending} className={btn} onClick={() => run(async () => { const r = await resetProgramTemplate(program.id); setTplMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Back to the standard wording.' }) })}>Use the standard wording</button>}
          <Note m={tplMsg} />
        </div>
      </Card>

      <Card n={5} title="What happens to the ticket">
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
            <input type="radio" checked readOnly className="mt-1" />
            <span><span className="block font-medium">Mail the vendor, then In Progress</span><span className="text-xs text-muted-foreground">The mail goes out when the ticket is raised and the ticket moves to In Progress by itself. A note in the conversation shows who it was sent to.</span></span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2 opacity-60">
            <input type="radio" disabled className="mt-1" />
            <span><span className="block font-medium">The vendor works the ticket in the vendor portal (coming next)</span><span className="text-xs text-muted-foreground">The mail goes out, the ticket stays Open, and the vendor&apos;s own technician takes it from there.</span></span>
          </label>
        </div>
      </Card>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Delete this program</h2>
        <p className="mb-2 text-xs text-muted-foreground">Only possible while no ticket has been mailed through it. Otherwise switch it off.</p>
        {!confirmDelete ? (
          <button type="button" className={btn} onClick={() => setConfirmDelete(true)}>Delete…</button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-700">Delete &quot;{program.name}&quot; and its copied rows?</span>
            <button type="button" disabled={pending} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" onClick={() => run(async () => { const r = await deleteProgram(program.id); if (r.error) { setActiveMsg({ ok: false, text: r.error }); setConfirmDelete(false) } else router.push('/admin/programs') })}>Yes, delete</button>
            <button type="button" className={btn} onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        )}
      </section>
    </div>
  )
}
