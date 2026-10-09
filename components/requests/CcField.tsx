'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { searchCcContacts } from '@/lib/actions/ticketCopy'

export interface CcChip {
  email: string
  name: string
  /** ok = a CK Desk address (user or OEM contact); bad = typed address that is not one, blocks posting until removed */
  status: 'ok' | 'bad'
  detail?: string
}

const MAX_CC = 5
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

interface Suggestion { email: string; name: string; kind: 'user' | 'oem'; detail: string }

/** The CC box under a public comment: pick CK Desk people / OEM contacts, or type an address (checked straight away). */
export function CcField({ chips, onChange, attachPdf, onAttachPdf }: {
  chips: CcChip[]
  onChange: (next: CcChip[]) => void
  attachPdf: boolean
  onAttachPdf: (v: boolean) => void
}) {
  const [text, setText] = useState('')
  const [options, setOptions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const latest = useRef(0)

  // suggestions follow the typing, a moment after the last key
  useEffect(() => {
    const q = text.trim()
    if (q.length < 2) return
    const ticket = ++latest.current
    const t = window.setTimeout(async () => {
      try {
        const found = await searchCcContacts(q)
        if (ticket === latest.current) { setOptions(found.filter((f) => !chips.some((c) => c.email === f.email))); setOpen(true) }
      } catch { if (ticket === latest.current) setOptions([]) }
    }, 220)
    return () => window.clearTimeout(t)
  }, [text, chips])

  const full = chips.length >= MAX_CC
  // suggestions only while there is something typed (older results are never shown for an emptied box)
  const shown = text.trim().length >= 2 ? options : []
  const addChip = (c: CcChip) => {
    if (chips.some((x) => x.email === c.email) || chips.length >= MAX_CC) return
    onChange([...chips, c])
  }
  const pick = (s: Suggestion) => { addChip({ email: s.email, name: s.name, status: 'ok', detail: s.detail }); setText(''); setOptions([]); setOpen(false) }

  // a typed address: accepted only if it is a CK Desk address, otherwise shown in red and blocks posting
  const commitTyped = async () => {
    const raw = text.trim().replace(/[,;]+$/, '')
    if (!raw) return
    setText(''); setOpen(false)
    const email = raw.toLowerCase()
    if (chips.some((c) => c.email === email)) return
    if (!looksLikeEmail(email)) { addChip({ email: raw, name: raw, status: 'bad', detail: 'Not a valid e-mail address' }); return }
    try {
      const found = await searchCcContacts(email)
      const hit = found.find((f) => f.email === email)
      addChip(hit ? { email: hit.email, name: hit.name, status: 'ok', detail: hit.detail } : { email, name: email, status: 'bad', detail: 'Not a CK Desk address' })
    } catch {
      addChip({ email, name: email, status: 'bad', detail: 'Could not be checked' })
    }
  }

  const bad = chips.filter((c) => c.status === 'bad')

  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-muted-foreground">CC</span>
        {chips.map((c) => (
          <span
            key={c.email}
            title={c.detail ? `${c.email} - ${c.detail}` : c.email}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${c.status === 'ok' ? 'border-primary/30 bg-primary/5 text-primary' : 'border-red-300 bg-red-50 text-red-700'}`}
          >
            {c.status === 'bad' && <AlertCircle className="h-3 w-3" />}
            {c.name}
            <button type="button" aria-label={`Remove ${c.email}`} onClick={() => onChange(chips.filter((x) => x.email !== c.email))} className="rounded-full hover:opacity-70"><X className="h-3 w-3" /></button>
          </span>
        ))}
        <div className="relative min-w-[200px] flex-1">
          <input
            value={text}
            disabled={full}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',' || e.key === ';') { e.preventDefault(); void commitTyped() } }}
            onBlur={() => { window.setTimeout(() => setOpen(false), 150); if (text.includes('@')) void commitTyped() }}
            onFocus={() => shown.length > 0 && setOpen(true)}
            placeholder={full ? `Up to ${MAX_CC} addresses` : 'Type a name or e-mail of a CK Desk user or OEM contact'}
            aria-label="CC e-mail"
            className="w-full bg-transparent px-1 py-0.5 text-xs outline-none placeholder:text-muted-foreground"
          />
          {open && shown.length > 0 && (
            <ul role="listbox" aria-label="CC suggestions" className="absolute bottom-full left-0 z-50 mb-1 max-h-56 w-80 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
              {shown.map((o) => (
                <li key={o.email}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)} className="w-full rounded-md px-2.5 py-1.5 text-left text-xs hover:bg-muted">
                    <span className="block font-medium text-foreground">{o.name} <span className="font-normal text-muted-foreground">- {o.detail}</span></span>
                    <span className="block text-muted-foreground">{o.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>They get an e-mail with the ticket details, the complete conversation and your new comment. Only CK Desk users and OEM contacts can be copied.</span>
        <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap font-medium text-foreground">
          <input type="checkbox" checked={attachPdf} onChange={(e) => onAttachPdf(e.target.checked)} />
          Attach ticket PDF
        </label>
      </div>
      {bad.length > 0 && (
        <p role="alert" className="text-xs text-red-700">
          {bad.map((b) => `${b.email}: ${b.detail ?? 'not allowed'}`).join(' · ')}. Remove {bad.length === 1 ? 'it' : 'them'} to post.
        </p>
      )}
    </div>
  )
}
