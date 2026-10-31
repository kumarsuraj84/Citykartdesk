'use client'

import { useMemo, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import {
  deleteProgram, resetProgramTemplate, saveProgramBasics, moveCategoriesToProgram, saveProgramApprovers, saveProgramCategories, saveProgramDetailsTemplate, saveProgramPortalOptions, saveProgramPmsSheet, saveProgramResolutions, saveProgramSheet, saveProgramTemplate, sendProgramTestMail, setProgramActive, setProgramLevel, updateProgramNow,
} from '@/lib/actions/admin/programs'
import { allowedFields, DEFAULT_PROGRAM_BODY, rowFieldNames } from '@/lib/programs/mail'
import { programSampleValues } from '@/lib/programs/sample'
import { DEFAULT_HEADINGS, FIELD_LABEL, PROGRAM_FIELDS, type ProgramColumns, type ProgramField } from '@/lib/programs/types'
import type { ProgramEditorData } from '@/lib/programs/admin-data'

const RichEmailEditor = dynamic(() => import('@/components/admin/RichEmailEditor'), {
  ssr: false,
  loading: () => <div className="min-h-[300px] rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground">Loading editor…</div>,
})

type Msg = { ok: boolean; text: string } | null

function Card({ n, title, hint, children }: { n: number | string; title: string; hint?: string; children: React.ReactNode }) {
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
  const { program, categories, issues, issueTotal, extraHeadings, readiness, staff } = data
  const [pending, start] = useTransition()

  const [name, setName] = useState(program.name)
  const [rowType, setRowType] = useState(program.row_type)
  const [basicsMsg, setBasicsMsg] = useState<Msg>(null)

  const [picked, setPicked] = useState<string[]>(categories.filter((c) => c.in_program).map((c) => c.id))
  const [catMsg, setCatMsg] = useState<Msg>(null)
  const [catFilter, setCatFilter] = useState('')

  const [link, setLink] = useState(program.spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${program.spreadsheet_id}/edit` : '')
  const [tab, setTab] = useState(program.tab_name ?? '')
  const [columns, setColumns] = useState<ProgramColumns>(program.columns ?? {})
  const [sheetMsg, setSheetMsg] = useState<Msg>(null)

  const [pmsLink, setPmsLink] = useState(program.pms_spreadsheet_id ? `https://docs.google.com/spreadsheets/d/${program.pms_spreadsheet_id}/edit` : '')
  const [pmsTab, setPmsTab] = useState(program.pms_tab_name ?? '')
  const [pmsMsg, setPmsMsg] = useState<Msg>(null)

  const [subject, setSubject] = useState(subject0)
  const [body, setBody] = useState(body0)
  const [tplMsg, setTplMsg] = useState<Msg>(null)

  const [activeMsg, setActiveMsg] = useState<Msg>(null)
  const [resText, setResText] = useState((program.resolution_options ?? []).join('\n'))
  const [resMsg, setResMsg] = useState<Msg>(null)
  const [levelMsg, setLevelMsg] = useState<Msg>(null)
  const [oemRequired, setOemRequired] = useState(program.oem_number_required === true)
  const [optMsg, setOptMsg] = useState<Msg>(null)
  const [detailsText, setDetailsText] = useState(program.details_template ?? '')
  const [detailsMsg, setDetailsMsg] = useState<Msg>(null)
  // the preview is filled with this program's OWN first sheet row (its store card and category), and follows the machine wording while it is typed
  const sampleValues = useMemo(
    () => programSampleValues({ name: program.name, row_type: program.row_type, details_template: detailsText }, data.sampleRow, { categoryName: data.sampleCategory, store: data.sampleStore }),
    [program.name, program.row_type, detailsText, data.sampleRow, data.sampleCategory, data.sampleStore],
  )
  const [moveIds, setMoveIds] = useState<string[]>([])
  const [moveMsg, setMoveMsg] = useState<Msg>(null)
  const [approvers, setApprovers] = useState<string[]>(program.default_approver_ids ?? [])
  const [approverFilter, setApproverFilter] = useState('')
  const [apprMsg, setApprMsg] = useState<Msg>(null)
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
        <input value={catFilter} onChange={(e) => setCatFilter(e.target.value)} placeholder="Search a category" aria-label="Search a category" className="mb-2 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm sm:w-80" />
        <p className="mb-2 text-[11px] text-muted-foreground">{picked.length} ticked. Ticked categories always stay in the list.</p>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {categories.filter((c) => picked.includes(c.id) || c.name.toLowerCase().includes(catFilter.trim().toLowerCase())).map((c) => (
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

      {categories.some((c) => c.old_kind) && (
        <Card n={2} title="Move categories from the old AC / Genset setting" hint="These categories still send their tickets with the OLD AC / Genset setting. Moving them here makes this program do it instead, and switches the program on in the same step (so no ticket is left without its mail). The program must be ready first: sheet read, mail wording written. You can move a category back from the AC / Genset (built in) screen.">
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {categories.filter((c) => c.old_kind).map((c) => (
              <label key={c.id} className="flex items-start gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm">
                <input type="checkbox" className="mt-0.5" checked={moveIds.includes(c.id)} onChange={(e) => setMoveIds((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                <span><span className="block">{c.name}</span><span className="block text-[11px] text-muted-foreground">Old setting: {c.old_kind === 'ac' ? 'AC' : 'Genset'} OEM</span></span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" disabled={pending || moveIds.length === 0} className={btnPrimary} onClick={() => run(async () => { const r = await moveCategoriesToProgram(program.id, moveIds); setMoveMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Moved. The program is on: new tickets of these categories now use it.' }); if (!r.error) setMoveIds([]) })}>Move to this program and switch it on</button>
            <Note m={moveMsg} />
          </div>
        </Card>
      )}

      <Card n={3} title="Google Sheet" hint="The sheet is the master list. CK Desk copies it at 11:00, 15:00 and 19:00 and never changes it. Needed columns: Store Code and Ticket Mail To (and Machine No for one row per machine). Only when the vendor portal is switched on for this program are PO Mail To (the mail to the vendor when the PO is approved) and Quote Approval Mail To (who approves the vendor's quote) used too; for a mail-only program they are ignored. Any other column is kept and can be used in the mail.">
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
            <summary className="cursor-pointer text-xs font-medium text-foreground">See the {issueTotal > issues.length ? `first ${issues.length} of ${issueTotal}` : issues.length} problem{issueTotal === 1 ? '' : 's'} in the sheet</summary>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
              {issues.map((i, k) => <li key={k} className={i.severity === 'error' ? 'text-red-700' : 'text-amber-800'}>{i.message}</li>)}
            </ul>
          </details>
        )}
      </Card>

      <Card n="+" title="PMS tickets (optional)" hint="Only if this program has scheduled service visits (PMS, preventive maintenance). If it has none, leave this empty: nothing is created and nothing else changes. With a PMS sheet, CK Desk makes ONE ticket per store on its PMS date (from 09:00), mails it to this program's vendor together with all the store's machines, and the vendor works it like any ticket of the program. The sheet has two columns: Store Code and PMS Date (one row per store and date, written like 25/10/2026). CK Desk copies it with the other sheets and never changes it.">
        <div className="flex flex-wrap items-center gap-2">
          <input value={pmsLink} onChange={(e) => setPmsLink(e.target.value)} aria-label="PMS Google Sheet link" placeholder="Paste the PMS Google Sheet link (leave empty if this program has no PMS)" className="min-w-[16rem] flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
          <input value={pmsTab} onChange={(e) => setPmsTab(e.target.value)} aria-label="PMS sheet tab name" placeholder="Tab name (optional)" className="w-44 rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(pmsLink.trim() !== '' || !!program.pms_spreadsheet_id) && <button type="button" disabled={pending} className={btn} onClick={() => run(async () => { const r = await saveProgramPmsSheet(program.id, pmsLink, pmsTab); setPmsMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: pmsLink.trim() ? 'Saved. Press "Update from sheet now" above to copy it.' : 'Saved. This program has no PMS tickets.' }) })}>{pmsLink.trim() ? 'Save PMS sheet' : 'Remove PMS sheet'}</button>}
          <Note m={pmsMsg} />
        </div>
        {program.pms_spreadsheet_id && (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Last checked</dt><dd>{program.pms_last_checked_at ? formatDateTime(program.pms_last_checked_at) : 'not yet'}</dd></div>
              <div><dt className="text-muted-foreground">PMS dates read</dt><dd>{program.pms_row_count ?? '-'}</dd></div>
              <div><dt className="text-muted-foreground">Status</dt><dd>{program.pms_last_status === 'ok' ? 'OK' : program.pms_last_status === 'error' ? 'Problem' : 'not yet copied'}</dd></div>
            </dl>
            {program.pms_last_status === 'error' && program.pms_last_error && <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{program.pms_last_error} CK Desk keeps the last good copy.</p>}
            <p className="mt-3 text-[11px] text-muted-foreground">To make the tickets you also need: a category for the PMS tickets (Admin &gt; Categories, tick &quot;AC PMS category&quot;) added to this program in the Categories card above and to a service, this program switched on, and a Business Rule if the PMS tickets should go to a particular vendor technician. Problems (a date CK Desk cannot read, a store with no login) appear in the problems list above.</p>
          </>
        )}
      </Card>

      <Card n={4} title="The mail to the vendor" hint="Sent once when a ticket is raised. Use the field buttons to put the ticket's details in. The sheet's extra columns are available too.">
        <label className="mb-1 block text-xs font-medium" htmlFor="program-subject">Subject</label>
        <input id="program-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="mb-3 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
        <RichEmailEditor label="Message" value={body} onChange={setBody} placeholders={allowedFields(extraHeadings)} sampleValues={sampleValues} starterHtml={DEFAULT_PROGRAM_BODY} />
        <p className="mt-1 text-[11px] text-muted-foreground">{data.sampleRow ? `The preview and "Send a test to me" use the first row of this program's sheet (store ${data.sampleRow.store_code}), not a real ticket.` : 'The preview uses example text: this program has no sheet row yet.'}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" disabled={pending} className={btnPrimary} onClick={() => run(async () => { const r = await saveProgramTemplate(program.id, subject, body); setTplMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' }) })}>Save the mail</button>
          <button type="button" disabled={pending} className={btn} onClick={() => run(async () => { const r = await sendProgramTestMail(program.id); setTplMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: `A test mail was sent to ${r.sentTo} only.` }) })}>Send a test to me</button>
          {customTemplate && <button type="button" disabled={pending} className={btn} onClick={() => run(async () => { const r = await resetProgramTemplate(program.id); setTplMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Back to the standard wording.' }) })}>Use the standard wording</button>}
          <Note m={tplMsg} />
        </div>
      </Card>

      <Card n={4} title="How one machine is written in the mail (optional)" hint="The mail line {{details}} lists every machine of the store, one line each. Write here how ONE machine is written, using the buttons below. Example for a genset: {{extra_gensetbrand}} {{extra_gensetkva}} KVA, serial {{serial}}, {{extra_cpcbgroup}}. Leave it empty for the usual short wording.">
        <input value={detailsText} onChange={(e) => setDetailsText(e.target.value)} maxLength={300} aria-label="How one machine is written" placeholder="{{extra_gensetbrand}} {{extra_gensetkva}} KVA, serial {{serial}}" className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {rowFieldNames(extraHeadings).map((f) => <button key={f} type="button" className="rounded border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px]" onClick={() => setDetailsText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}{{${f}}}`)}>{`{{${f}}}`}</button>)}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="button" disabled={pending} className={btn} onClick={() => run(async () => { const r = await saveProgramDetailsTemplate(program.id, detailsText); setDetailsMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' }) })}>Save</button>
          <Note m={detailsMsg} />
        </div>
      </Card>

      <Card n={5} title="What happens to the ticket">
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
            <input type="radio" name="program-level" checked={program.level === 'mail'} disabled={pending} onChange={() => run(async () => { const r = await setProgramLevel(program.id, 'mail'); setLevelMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' }) })} className="mt-1" />
            <span><span className="block font-medium">Mail the vendor, then In Progress</span><span className="text-xs text-muted-foreground">The mail goes out when the ticket is raised and the ticket moves to In Progress by itself. A note in the conversation shows who it was sent to.</span></span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-border px-3 py-2">
            <input type="radio" name="program-level" checked={program.level === 'portal'} disabled={pending} onChange={() => run(async () => { const r = await setProgramLevel(program.id, 'portal'); setLevelMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' }) })} className="mt-1" />
            <span><span className="block font-medium">The vendor works the ticket in the vendor portal</span><span className="text-xs text-muted-foreground">The mail goes out and the ticket stays Open for the vendor technician it is given to (by your Business Rules). He starts it, asks for parts, sends the quote (the approvers are in the sheet column Quote Approval Mail To), and resolves with the FSR.</span></span>
          </label>
          <Note m={levelMsg} />
          {program.level === 'portal' && (
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs font-medium">How the ticket reaches a vendor technician</p>
              <p className="mt-1 text-[11px] text-muted-foreground">In CK Desk only, nothing in the sheet decides it: create Business Rules (Admin &gt; Business Rules) that assign the tickets of this category to particular vendor technicians, just as you do for Citykart technicians (direct, round robin or load balanced; conditions such as the category, the store or its location). A ticket no rule gave to a vendor technician stays with Citykart staff, with a note, to assign by hand. The vendor companies, their technicians and their managers (view only) are created in Admin &gt; Vendors.</p>
              <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={oemRequired} onChange={(e) => setOemRequired(e.target.checked)} /><span>The vendor must enter the OEM ticket number to start work (AC always needs it; here it is optional until you switch this on)</span></label>
              <div className="mt-2 flex items-center gap-3">
                <button type="button" disabled={pending} className={btn} onClick={() => run(async () => { const r = await saveProgramPortalOptions(program.id, { oemRequired }); setOptMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' }) })}>Save this choice</button>
                <Note m={optMsg} />
              </div>
            </div>
          )}
          {program.level === 'portal' && (
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs font-medium">Default PO approvers of this program</p>
              <p className="mt-1 text-[11px] text-muted-foreground">When a vendor sends a quote, it goes to the approvers named in the sheet column Quote Approval Mail To (if they are active CK Desk logins). If the sheet names nobody for the store, it goes to the people chosen here (any one of them can decide). Each program has its own; the default approver on the Vendors page is for AC only.</p>
              <input value={approverFilter} onChange={(e) => setApproverFilter(e.target.value)} placeholder="Find a person" aria-label="Find a person" className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm sm:w-72" />
              <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
                {staff.filter((s) => approvers.includes(s.id) || s.full_name.toLowerCase().includes(approverFilter.trim().toLowerCase())).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={approvers.includes(s.id)} onChange={(e) => setApprovers((a) => (e.target.checked ? [...a, s.id] : a.filter((x) => x !== s.id)))} />{s.full_name} <span className="text-[11px] text-muted-foreground">{s.role}</span></label>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <button type="button" disabled={pending} className={btn} onClick={() => run(async () => { const r = await saveProgramApprovers(program.id, approvers); setApprMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' }) })}>Save the approvers</button>
                <Note m={apprMsg} />
              </div>
            </div>
          )}
          {program.level === 'portal' && (
            <div className="rounded-lg border border-border px-3 py-2">
              <label htmlFor="program-resolutions" className="block text-xs font-medium">Resolutions the vendor chooses from (one per line)</label>
              <textarea id="program-resolutions" rows={6} value={resText} onChange={(e) => setResText(e.target.value)} placeholder={'Cartridge replaced\nPump replaced\nTDS adjusted'} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm" />
              <p className="mt-1 text-[11px] text-muted-foreground">&quot;Other&quot; is always offered in addition (the vendor then writes what he did). Each line of the AC, Genset and every other line has its own list.</p>
              <div className="mt-2 flex items-center gap-3">
                <button type="button" disabled={pending} className={btn} onClick={() => run(async () => { const r = await saveProgramResolutions(program.id, resText); setResMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' }) })}>Save the resolutions</button>
                <Note m={resMsg} />
              </div>
            </div>
          )}
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
