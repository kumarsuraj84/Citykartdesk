'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Paperclip, Play, CheckCircle2, X, Send, Wrench, PackageCheck, Plus, Trash2, FileText } from 'lucide-react'
import { uploadAttachment } from '@/lib/actions/attachments'
import { vendorAddComment, vendorPartsReceived, vendorRequestParts, vendorRequestPo, vendorResolve, vendorStartWorking } from '@/lib/actions/vendor'
import { formatMoney, totalOf, type RequestLineInput } from '@/lib/vendor/lines'
import { validateAttachment } from '@/lib/attachments/validate'
import { isOtherChoice, type ResolutionChoice } from '@/lib/vendor/fields'

// The buttons of the vendor's ticket page: Start working (needs the OEM ticket number), Resolve (AC RESOLUTION choice + FSR) and a message box.
// The server repeats every check; these windows only make the rules visible.

const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv'
const inputCls = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20'
const primaryBtn = 'inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60'
const ghostBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** The item rows of the "Part required" / PO windows: item name and quantity (a PO window also asks the price without GST). */
export function LinesEditor({ lines, onChange, withPrice }: { lines: RequestLineInput[]; onChange: (next: RequestLineInput[]) => void; withPrice: boolean }) {
  const set = (i: number, patch: Partial<RequestLineInput>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const num = (v: number | string | null | undefined) => Number(String(v ?? '').replace(/,/g, '')) || 0
  const total = totalOf(lines.map((l) => ({ qty: num(l.qty), price_excl_gst: withPrice ? num(l.price_excl_gst) : 0 })))
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div key={i} className={withPrice ? 'grid grid-cols-[1fr_5rem_auto] items-center gap-2 sm:grid-cols-[1fr_5rem_8rem_auto]' : 'grid grid-cols-[1fr_5rem_auto] items-center gap-2'}>
          <input className={inputCls} placeholder="Item name" aria-label={`Item ${i + 1} name`} value={l.item_name} maxLength={200} onChange={(e) => set(i, { item_name: e.target.value })} />
          <input className={inputCls} placeholder="Qty" aria-label={`Item ${i + 1} quantity`} inputMode="decimal" value={String(l.qty ?? '')} onChange={(e) => set(i, { qty: e.target.value })} />
          {withPrice && <input className={`${inputCls} col-span-2 sm:col-span-1`} placeholder="Price (no GST)" aria-label={`Item ${i + 1} price without GST`} inputMode="decimal" value={String(l.price_excl_gst ?? '')} onChange={(e) => set(i, { price_excl_gst: e.target.value })} />}
          <button type="button" className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-40" disabled={lines.length <= 1} aria-label={`Remove item ${i + 1}`} onClick={() => onChange(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <button type="button" className="inline-flex items-center gap-1 text-sm text-primary hover:underline" onClick={() => onChange([...lines, { item_name: '', qty: '', price_excl_gst: '' }])}><Plus className="h-4 w-4" /> Add another item</button>
        {withPrice && <div className="text-sm font-medium">Total (without GST): {formatMoney(total)}</div>}
      </div>
    </div>
  )
}

export const emptyLines = (): RequestLineInput[] => [{ item_name: '', qty: '', price_excl_gst: '' }]

export interface VendorTicketActionsProps {
  requestId: string
  status: string
  /** a vendor TECHNICIAN whose ticket this is; a manager (read only) or anybody else sees no buttons */
  canAct: boolean
  resolutionChoices: ResolutionChoice[]
  /** what the ticket's hold is for, while it is on hold (a pending request): parts, or a PO from Citykart */
  holdKind?: 'parts' | 'po' | null
  /** extra buttons for the PO window (added by the PO screens) */
  extra?: React.ReactNode
}

export function VendorTicketActions({ requestId, status, canAct, resolutionChoices, holdKind = null, extra }: VendorTicketActionsProps) {
  const router = useRouter()
  const [modal, setModal] = useState<null | 'start' | 'resolve' | 'parts' | 'received' | 'po'>(null)
  const [lines, setLines] = useState<RequestLineInput[]>(emptyLines())
  const [poLines, setPoLines] = useState<RequestLineInput[]>(emptyLines())
  const [receivedNote, setReceivedNote] = useState('')
  const [pending, startTransition] = useTransition()
  const [oem, setOem] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [choice, setChoice] = useState('')
  const [remarks, setRemarks] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const close = () => { setModal(null); setError(null) }
  const done = (text: string) => { toast.success(text); close(); router.refresh() }

  const start = () => startTransition(async () => {
    setError(null)
    const res = await vendorStartWorking(requestId, oem)
    if (res.error) { setError(res.error); return }
    setOem(''); done('Work started.')
  })

  const addFiles = async (incoming: File[]) => {
    setError(null)
    for (const f of incoming) {
      const v = await validateAttachment(f)
      if (!v.valid) { setError(`"${f.name}": ${v.error ?? 'Invalid file.'}`); return }
    }
    setFiles((cur) => [...cur, ...incoming])
  }

  const resolve = () => startTransition(async () => {
    setError(null)
    if (!choice) { setError('Please choose the resolution.'); return }
    if (isOtherChoice(resolutionChoices.find((c) => c.value === choice)?.label) && remarks.trim().length < 10) { setError('Please describe what you did (at least 10 characters), because you chose "Other".'); return }
    if (files.length === 0) { setError('Please attach the FSR (field service report) before resolving.'); return }
    const ids: string[] = []
    for (const f of files) {
      const fd = new FormData(); fd.append('file', f)
      const up = await uploadAttachment(requestId, fd)
      if (up.error || !up.attachmentId) { setError(up.error ?? 'Upload failed.'); return }
      ids.push(up.attachmentId)
    }
    const res = await vendorResolve({ requestId, choice, remarks, attachmentIds: ids })
    if (res.error) { setError(res.error); return }
    setChoice(''); setRemarks(''); setFiles([])
    done('Ticket resolved.')
  })

  const askParts = () => startTransition(async () => {
    setError(null)
    const res = await vendorRequestParts({ requestId, lines })
    if (res.error) { setError(res.error); return }
    setLines(emptyLines()); done('The ticket is on hold until the parts arrive.')
  })

  const askPo = () => startTransition(async () => {
    setError(null)
    const res = await vendorRequestPo({ requestId, lines: poLines })
    if (res.error) { setError(res.error); return }
    setPoLines(emptyLines()); done('PO requested. The ticket is on hold until Citykart decides.')
  })

  const partsReceived = () => startTransition(async () => {
    setError(null)
    const res = await vendorPartsReceived(requestId, receivedNote)
    if (res.error) { setError(res.error); return }
    setReceivedNote(''); done('Back in progress.')
  })

  const send = () => startTransition(async () => {
    const res = await vendorAddComment(requestId, message)
    if (res.error) { toast.error(res.error); return }
    setMessage(''); router.refresh()
  })

  const canStart = canAct && (status === 'open' || status === 'assigned')
  const canResolve = canAct && status === 'in_progress'
  const canAsk = canResolve
  const canReceive = canAct && status === 'hold_purchase_ho' && holdKind === 'parts'

  return (
    <div className="space-y-3">
      {canAct && status === 'hold_purchase_ho' && holdKind === 'po' && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">Waiting for Citykart to approve your PO request. You will be told as soon as it is decided.</p>
      )}

      {(canStart || canResolve || canReceive || extra) && (
        <div className="flex flex-wrap items-center gap-2">
          {canStart && <button type="button" className={primaryBtn} onClick={() => setModal('start')}><Play className="h-4 w-4" /> Start working</button>}
          {canResolve && <button type="button" className={primaryBtn} onClick={() => setModal('resolve')}><CheckCircle2 className="h-4 w-4" /> Resolve</button>}
          {canAsk && <button type="button" className={ghostBtn} onClick={() => setModal('po')}><FileText className="h-4 w-4" /> PO required</button>}
          {canAsk && <button type="button" className={ghostBtn} onClick={() => setModal('parts')}><Wrench className="h-4 w-4" /> Part required</button>}
          {canReceive && <button type="button" className={primaryBtn} onClick={() => setModal('received')}><PackageCheck className="h-4 w-4" /> Parts received</button>}
          {extra}
        </div>
      )}

      {canAct && status !== 'closed' && status !== 'cancelled' && (
        <div className="rounded-xl border border-border p-3">
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="vendor-msg">Message to the store / Citykart</label>
          <textarea id="vendor-msg" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls} maxLength={5000} placeholder="Write a message" />
          <div className="mt-2 flex justify-end">
            <button type="button" className={ghostBtn} disabled={pending || !message.trim()} onClick={send}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
            </button>
          </div>
        </div>
      )}

      {modal === 'start' && (
        <Modal title="Start working" onClose={close}>
          <p className="mb-3 text-sm text-muted-foreground">Enter the ticket number of the OEM (your company) for this job. The ticket does not move without it.</p>
          <label className="mb-1 block text-xs font-medium" htmlFor="oem-no">OEM ticket number *</label>
          <input id="oem-no" autoFocus value={oem} onChange={(e) => setOem(e.target.value)} maxLength={60} className={inputCls} placeholder="For example VT-2026-004512" />
          {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={ghostBtn} onClick={close}>Cancel</button>
            <button type="button" className={primaryBtn} disabled={pending || !oem.trim()} onClick={start}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Start working
            </button>
          </div>
        </Modal>
      )}

      {modal === 'po' && (
        <Modal title="PO required from Citykart" onClose={close}>
          <p className="mb-3 text-sm text-muted-foreground">List what Citykart must buy. Give the price of each item <strong>without GST</strong>. The ticket goes on hold and one approval request goes to Citykart.</p>
          <LinesEditor lines={poLines} onChange={setPoLines} withPrice />
          {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={ghostBtn} onClick={close}>Cancel</button>
            <button type="button" className={primaryBtn} disabled={pending} onClick={askPo}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} Send for approval</button>
          </div>
        </Modal>
      )}

      {modal === 'parts' && (
        <Modal title="Part required (no PO)" onClose={close}>
          <p className="mb-3 text-sm text-muted-foreground">List the parts you need. The ticket goes on hold until you report the parts received.</p>
          <LinesEditor lines={lines} onChange={setLines} withPrice={false} />
          {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={ghostBtn} onClick={close}>Cancel</button>
            <button type="button" className={primaryBtn} disabled={pending} onClick={askParts}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} Put on hold</button>
          </div>
        </Modal>
      )}

      {modal === 'received' && (
        <Modal title="Parts received" onClose={close}>
          <p className="mb-3 text-sm text-muted-foreground">The engineer has the parts. The ticket goes back to In Progress; you can resolve it after that.</p>
          <label className="mb-1 block text-xs font-medium" htmlFor="parts-note">Remark *</label>
          <textarea id="parts-note" rows={3} className={inputCls} maxLength={1000} value={receivedNote} onChange={(e) => setReceivedNote(e.target.value)} placeholder="For example: parts received, engineer on site" />
          {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={ghostBtn} onClick={close}>Cancel</button>
            <button type="button" className={primaryBtn} disabled={pending || receivedNote.trim().length < 3} onClick={partsReceived}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} Back to In Progress</button>
          </div>
        </Modal>
      )}

      {modal === 'resolve' && (
        <Modal title="Resolve this ticket" onClose={close}>
          <label className="mb-1 block text-xs font-medium" htmlFor="res-choice">Resolution *</label>
          <select id="res-choice" value={choice} onChange={(e) => setChoice(e.target.value)} className={inputCls}>
            <option value="">Choose the resolution…</option>
            {resolutionChoices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>

          <label className="mb-1 mt-3 block text-xs font-medium" htmlFor="res-remarks">
            Remarks {isOtherChoice(resolutionChoices.find((c) => c.value === choice)?.label) ? '*' : '(optional)'}
          </label>
          <textarea id="res-remarks" rows={4} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={2000} className={inputCls}
            placeholder={isOtherChoice(resolutionChoices.find((c) => c.value === choice)?.label) ? 'Describe what you did - this becomes the final resolution' : 'Anything the store should know'} />

          <div className="mt-3">
            <div className="mb-1 text-xs font-medium">FSR attachment *</div>
            <input ref={fileRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.currentTarget.value = '' }} />
            <button type="button" className={ghostBtn} onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /> Attach the FSR</button>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                    <span className="truncate">{f.name}</span>
                    <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}><X className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={ghostBtn} onClick={close}>Cancel</button>
            <button type="button" className={primaryBtn} disabled={pending} onClick={resolve}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Resolve
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
