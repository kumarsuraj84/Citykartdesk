'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw, Download } from 'lucide-react'
import { ModalFrame } from '@/components/ui/ModalFrame'
import { safely } from '@/lib/ui/safeAction'
import { parseCSV, rowsToObjects } from '@/lib/import/csv'
import { toCSV, downloadCSV } from '@/lib/export/csv'
import { updateUserContactsFromSheet, type ContactUpdateResult } from '@/lib/actions/admin/users'

// Fixes the employee code and the mobile number of people who already have an account, from a sheet (same file layout as the Import and the Export).
// Step 1 "Check the file" writes nothing and shows what would change; step 2 "Apply" writes it.
export function UpdateUserContactsDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, string>[] | null>(null)
  const [cols, setCols] = useState<{ emp: boolean; mob: boolean }>({ emp: false, mob: false })
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<ContactUpdateResult | null>(null)
  const [result, setResult] = useState<ContactUpdateResult | null>(null)

  function reset() { setFileName(null); setRows(null); setError(null); setPreview(null); setResult(null) }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    reset()
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer
      let text: string
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch { text = new TextDecoder('windows-1252').decode(buffer) }
      const csv = parseCSV(text)
      if (csv.length < 2) { setError('No data rows found in this file.'); return }
      const headers = csv[0].map((h) => h.trim().toLowerCase())
      if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) { setError('This file has duplicate column headers. Please fix the file and upload it again.'); return }
      if (!headers.includes('email')) { setError('This file has no "email" column. The e-mail is how each person is found.'); return }
      const emp = headers.includes('employee_id'), mob = headers.includes('mobile_number')
      if (!emp && !mob) { setError('This file has neither an "employee_id" nor a "mobile_number" column, so there is nothing to update.'); return }
      setCols({ emp, mob })
      setRows(rowsToObjects(csv))
    }
    reader.onerror = () => setError('Could not read that file.')
    reader.readAsArrayBuffer(file)
  }

  function run(apply: boolean) {
    if (!rows) return
    setError(null)
    startTransition(async () => {
      const res = await safely(() => updateUserContactsFromSheet(
        rows.map((r) => ({ email: r.email, employee_id: r.employee_id, mobile_number: r.mobile_number })),
        { apply, hasEmployeeColumn: cols.emp, hasMobileColumn: cols.mob }
      ))
      if (res.error || !res.data) { setError(res.error ?? 'Something went wrong.'); return }
      if (apply) { setResult(res.data); setPreview(null); router.refresh() } else setPreview(res.data)
    })
  }

  function downloadChanges(r: ContactUpdateResult) {
    downloadCSV('employee-code-mobile-changes.csv', toCSV(r.changes, [
      { key: 'email', label: 'email' }, { key: 'field', label: 'field' }, { key: 'before', label: 'before' }, { key: 'after', label: 'after' },
    ]))
  }

  const shown = result ?? preview
  const c = shown?.counts
  const nothing = !!shown && shown.changes.length === 0

  return (
    <>
      <button onClick={() => { reset(); setOpen(true) }} className="btn-glossy-light btn-glossy-light-hover">
        <RefreshCw className="h-3.5 w-3.5" />
        Update codes &amp; mobiles
      </button>

      {open && (
        <ModalFrame label="Update employee codes and mobile numbers" onClose={() => setOpen(false)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-ink">Update employee codes &amp; mobile numbers</h2>
              <button onClick={() => setOpen(false)} className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><span aria-hidden>×</span></button>
            </div>

            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-xs text-foreground space-y-1.5">
              <p>For people who <b>already have an account</b> (found by their e-mail), this makes the <b>employee code</b> and the <b>mobile number</b> exactly as in your file:</p>
              <ul className="list-disc space-y-0.5 pl-5">
                <li>a value in the file is saved;</li>
                <li>an <b>empty cell clears</b> it;</li>
                <li>nothing else of the person changes (e-mail, name, role, store, location, manager, password).</li>
              </ul>
              <p className="text-muted-foreground">Use the file from Export (or the Import sample): columns <code>email</code>, <code>employee_id</code>, <code>mobile_number</code>. A column that is not in the file is left alone. New people are not created here — use Import for that. You see the list of changes first; nothing is saved until you press Apply.</p>
            </div>

            {!result && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">CSV file</label>
                <input type="file" accept=".csv,text/csv" onChange={onFile}
                  className="block w-full text-xs text-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-foreground hover:file:bg-muted/40" />
                {fileName && rows && <p className="text-xs text-muted-foreground">{fileName}: {rows.length} rows. Will update: {[cols.emp && 'employee code', cols.mob && 'mobile number'].filter(Boolean).join(' and ')}.</p>}
              </div>
            )}

            {error && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

            {shown && c && (
              <div className={`space-y-2 rounded-lg border px-3 py-2 text-xs ${result ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-border bg-muted/30 text-foreground'}`}>
                <p className="font-semibold">
                  {result ? `Done: ${result.written ?? 0} change${result.written === 1 ? '' : 's'} saved.` : nothing ? 'Nothing to change: the people already match the file.' : `${shown.changes.length} change${shown.changes.length === 1 ? '' : 's'} would be made.`}
                </p>
                <ul className="space-y-0.5">
                  <li>People found in the file: {c.peopleFound} of {c.rowsInFile} rows{c.notFound ? ` (${c.notFound} e-mail${c.notFound === 1 ? '' : 's'} without an account)` : ''}</li>
                  {cols.emp && <li>Employee code: {c.employeeSet} to set, <b className={c.employeeCleared ? 'text-red-600' : ''}>{c.employeeCleared} to clear</b>, {c.employeeUnchanged} already the same</li>}
                  {cols.mob && <li>Mobile number: {c.mobileSet} to set, <b className={c.mobileCleared ? 'text-red-600' : ''}>{c.mobileCleared} to clear</b>, {c.mobileUnchanged} already the same</li>}
                </ul>
                {shown.changes.length > 0 && (
                  <>
                    <p className="pt-1 font-medium">{result ? 'Changes made' : 'First changes'}:</p>
                    <ul className="space-y-0.5 font-mono text-[11px]">
                      {shown.changes.slice(0, 8).map((x, i) => (
                        <li key={i}>{x.email} — {x.field === 'employee_code' ? 'code' : 'mobile'}: {x.before || '(empty)'} → {x.after || '(empty)'}</li>
                      ))}
                    </ul>
                    {shown.changes.length > 8 && <p className="text-muted-foreground">…and {shown.changes.length - 8} more (download the full list).</p>}
                    <button type="button" onClick={() => downloadChanges(shown)} className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/40">
                      <Download className="h-3.5 w-3.5" /> Download the list of changes
                    </button>
                  </>
                )}
                {shown.problems.length > 0 && (
                  <div className="pt-1">
                    <p className="font-medium text-amber-700">Not changed ({shown.problems.length}):</p>
                    <ul className="list-inside list-disc space-y-0.5 text-amber-700">
                      {shown.problems.slice(0, 12).map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                    {shown.problems.length > 12 && <p className="text-amber-700">…and {shown.problems.length - 12} more.</p>}
                  </div>
                )}
                {result?.failed && result.failed.length > 0 && (
                  <div className="pt-1">
                    <p className="font-medium text-red-700">Could not be saved ({result.failed.length}):</p>
                    <ul className="list-inside list-disc space-y-0.5 text-red-700">{result.failed.slice(0, 12).map((p, i) => <li key={i}>{p}</li>)}</ul>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setOpen(false)} className="btn-soft">{result ? 'Close' : 'Cancel'}</button>
              {!result && !preview && (
                <button onClick={() => run(false)} disabled={pending || !rows} className="btn-gradient disabled:opacity-40">{pending ? 'Checking…' : 'Check the file'}</button>
              )}
              {!result && preview && (
                <button onClick={() => run(true)} disabled={pending || nothing} className="btn-gradient disabled:opacity-40">
                  {pending ? 'Saving…' : `Apply ${preview.changes.length} change${preview.changes.length === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          </div>
        </ModalFrame>
      )}
    </>
  )
}
