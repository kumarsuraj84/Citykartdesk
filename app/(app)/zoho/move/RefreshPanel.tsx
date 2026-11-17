'use client'

import { useState, useTransition } from 'react'
import { refreshMovedFieldsAction, type RefreshActionResult } from '@/lib/actions/zohoTransfer'

/**
 * "Fill in the fields of tickets already moved". For when a field was mapped AFTER the tickets were moved (for example the contact number).
 * Only EMPTY CK Desk fields are filled, nothing is overwritten, nothing else changes, nobody is notified.
 */
export function RefreshPanel({ canMove }: { canMove: boolean }) {
  const [text, setText] = useState('')
  const [res, setRes] = useState<RefreshActionResult | null>(null)
  const [pending, start] = useTransition()
  if (!canMove) return null

  function go() {
    const numbers = [...new Set(text.split(/[\s,;]+/).map((t) => t.replace(/^#/, '').replace(/^ZOHO-/i, '')).filter(Boolean).map(Number))]
    if (numbers.length === 0 || numbers.some((n) => !Number.isSafeInteger(n) || n <= 0)) { setRes({ error: 'Type the Zoho ticket numbers, separated by spaces or commas.' }); return }
    setRes(null)
    start(async () => setRes(await refreshMovedFieldsAction(numbers)))
  }

  return (
    <details className="rounded-lg border border-border bg-card p-3 text-xs">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">Fill in the fields and files of tickets already moved</summary>
      <div className="mt-2 space-y-2">
        <p className="text-muted-foreground">
          Use this after you map a Zoho field (for example the contact number), or after the Zoho files folder is set up, for tickets that were moved earlier. Only <strong>empty</strong> CK Desk fields are filled and only files that are <strong>not on the ticket yet</strong> are attached; nothing already there is overwritten or added twice.
          Nothing else on the ticket changes and nobody is notified.
        </p>
        <label className="block">
          <span className="text-muted-foreground">Zoho ticket numbers (up to 100)</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" placeholder="for example 10234, 10235" />
        </label>
        <button type="button" onClick={go} disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">{pending ? 'Filling in…' : 'Fill in the empty fields and missing files'}</button>
        {res?.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">{res.error}</p>}
        {res?.results && (
          <ul role="status" className="space-y-1 rounded-md border border-border p-3">
            {res.results.map((r) => (
              <li key={r.zohoNo} className={r.ok ? 'text-foreground' : 'text-red-800 dark:text-red-300'}>
                {r.ok
                  ? <>{r.filled.length ? '✓' : '–'} Zoho {r.zohoNo}{r.requestNo ? <> (<strong>{r.requestNo}</strong>)</> : null}: {r.filled.length ? `filled ${r.filled.join('; ')}` : 'no field to fill'}{r.files ? <>; files: {r.files.copied} attached{r.files.missing ? `, ${r.files.missing} could not be attached` : ''}{r.files.already ? `, ${r.files.already} already there` : ''}</> : null}{r.left.length ? <span className="text-amber-700 dark:text-amber-400"> — not filled: {r.left.join('; ')}</span> : null}</>
                  : <>✗ Zoho {r.zohoNo}: {r.reason}</>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
