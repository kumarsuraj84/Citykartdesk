'use client'

import { useRef, useState, useTransition } from 'react'
import { previewStoreMaster, applyStoreMaster, downloadStoreMasterSample, type StoreMasterPreview, type StoreMasterResult } from '@/lib/actions/admin/storeMaster'
import { downloadXlsxBase64 } from '@/lib/export/xlsx'

/**
 * Upload the Store Master sheet (Excel or CSV) into the Stores. Two steps so nothing is changed by surprise:
 * choosing the file shows what it would do (which columns are understood, how many stores change, which store
 * codes are not in CK Desk), and only "Update stores" saves it.
 */
export function StoreMasterUploadModal({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<StoreMasterPreview | null>(null)
  const [result, setResult] = useState<StoreMasterResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addMissing, setAddMissing] = useState(false)
  const [pending, start] = useTransition()

  const formFor = (f: File) => {
    const fd = new FormData()
    fd.set('file', f)
    fd.set('addMissing', String(addMissing))
    return fd
  }

  function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f); setPreview(null); setResult(null); setError(null)
    if (!f) return
    start(async () => {
      const res = await previewStoreMaster(formFor(f))
      if (res.error || !res.data) { setError(res.error ?? 'Could not read the file.'); return }
      setPreview(res.data)
    })
  }

  function apply() {
    if (!file) return
    setError(null)
    start(async () => {
      const res = await applyStoreMaster(formFor(file))
      if (res.error || !res.data) { setError(res.error ?? 'Could not update the stores.'); return }
      setResult(res.data); setPreview(null)
      if (input.current) input.current.value = ''
    })
  }

  function sample() {
    setError(null)
    start(async () => {
      const res = await downloadStoreMasterSample()
      if (res.error || !res.data) { setError(res.error ?? 'Could not create the sample file.'); return }
      downloadXlsxBase64(res.data.filename, res.data.data)
    })
  }

  const nothingToDo = preview && preview.willChange === 0 && !(addMissing && preview.missing.length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">Upload Store Master</h2>
          <button onClick={onClose} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><span aria-hidden>×</span></button>
        </div>

        <div className="space-y-1 rounded-xl border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
          <p>Upload your Store Master sheet (<b>.xlsx</b> or .csv). The first column is the store code, headed <b>STORE</b>; the other columns can be any of:</p>
          <p className="font-mono text-[11px] text-foreground">CITY · STATE · CLUSTER · REGION · STORE PRIORITY LIST AS PER OPS · OPEN DATE · FESTIVAL</p>
          <p>and the AC details, used for the AC service only:</p>
          <p className="font-mono text-[11px] text-foreground">AC TOTAL · AC BRAND · AC-AMC BRAND · AC-AMC VENDOR · ZENATIX</p>
          <p>(and optionally NAME, ADDRESS, PIN CODE, ACTIVE). Only the columns in the file are updated, and an empty cell never wipes what is saved. Stores are matched by their code.</p>
          <button type="button" onClick={sample} disabled={pending} className="mt-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/40 disabled:opacity-50">
            Download sample file (.xlsx)
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="store-master-file">File</label>
          <input
            id="store-master-file" ref={input} type="file" accept=".xlsx,.csv" onChange={choose} disabled={pending}
            className="block w-full text-xs text-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-foreground hover:file:bg-muted/40"
          />
          {pending && !result && <p className="text-xs text-muted-foreground">Working…</p>}
        </div>

        {error && <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

        {preview && (
          <div className="space-y-3 text-xs">
            <div className="rounded-xl border border-border p-3">
              <p className="font-semibold text-foreground">{preview.fileName}: {preview.stores} store{preview.stores === 1 ? '' : 's'}</p>
              <p className="mt-1 text-muted-foreground">Columns used: {preview.columns.join(', ')}</p>
              {preview.ignored.length > 0 && <p className="mt-1 text-amber-700">Not used (not store fields): {preview.ignored.join(', ')}</p>}
              <p className="mt-2 text-foreground"><b>{preview.willChange}</b> store{preview.willChange === 1 ? '' : 's'} will be updated · {preview.unchanged} already match</p>
            </div>

            {preview.missing.length > 0 && (
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <p><b>{preview.missing.length}</b> store code{preview.missing.length === 1 ? ' is' : 's are'} in the file but not in CK Desk: {preview.missing.slice(0, 40).join(', ')}{preview.missing.length > 40 ? '…' : ''}</p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={addMissing} onChange={(e) => setAddMissing(e.target.checked)} className="rounded" />
                  Also add them as new stores (named by their code; rename them later)
                </label>
              </div>
            )}

            {preview.notes.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">{preview.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            )}
            {preview.problems.length > 0 && (
              <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-red-700">
                <p className="font-semibold">These rows will be skipped</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">{preview.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={apply} disabled={pending || !!nothingToDo} className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-semibold text-background hover:opacity-90 disabled:opacity-50">
                {pending ? 'Saving…' : 'Update stores'}
              </button>
              <button onClick={onClose} className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40">Cancel</button>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-2 text-xs">
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800">
              Done: {result.updated} updated{result.created > 0 ? `, ${result.created} added` : ''}, {result.unchanged} already matched{result.skipped > 0 ? `, ${result.skipped} skipped` : ''}.
            </p>
            {result.problems.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-red-700">{result.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            <button onClick={onClose} className="rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40">Close</button>
          </div>
        )}
      </div>
    </div>
  )
}
