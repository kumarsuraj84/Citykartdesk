'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Paperclip, XCircle } from 'lucide-react'
import { approveVendorPo, rejectVendorPo } from '@/lib/actions/vendor-po'
import { validateAttachment } from '@/lib/attachments/validate'

// The PO approver's form: approve (PO number, PO date, PO document - all compulsory) or reject (a reason). The server repeats every check.

const inputCls = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20'
const ACCEPT = '.png,.jpg,.jpeg,.pdf,.doc,.docx,.xls,.xlsx'

export function PoDecisionForm({ vendorRequestId, today }: { vendorRequestId: string; today: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [poNumber, setPoNumber] = useState('')
  const [poDate, setPoDate] = useState(today)
  const [file, setFile] = useState<File | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'approve' | 'reject'>('approve')
  const fileRef = useRef<HTMLInputElement>(null)

  const pick = async (f: File | undefined) => {
    setError(null)
    if (!f) return
    const v = await validateAttachment(f)
    if (!v.valid) { setError(`"${f.name}": ${v.error ?? 'Invalid file.'}`); return }
    setFile(f)
  }

  const approve = () => startTransition(async () => {
    setError(null)
    const fd = new FormData()
    fd.set('vendor_request_id', vendorRequestId); fd.set('po_number', poNumber); fd.set('po_date', poDate)
    if (file) fd.set('po_document', file)
    const res = await approveVendorPo(fd)
    if (res.error) { setError(res.error); return }
    toast.success('PO approved. The vendor and the OEM have been told.')
    router.refresh()
  })

  const reject = () => startTransition(async () => {
    setError(null)
    const res = await rejectVendorPo({ vendorRequestId, reason })
    if (res.error) { setError(res.error); return }
    toast.success('PO rejected. The ticket is cancelled.')
    router.refresh()
  })

  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <div className="flex gap-2" role="tablist" aria-label="Decision">
        <button type="button" role="tab" aria-selected={mode === 'approve'} onClick={() => { setMode('approve'); setError(null) }}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === 'approve' ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted'}`}>Approve</button>
        <button type="button" role="tab" aria-selected={mode === 'reject'} onClick={() => { setMode('reject'); setError(null) }}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === 'reject' ? 'bg-destructive text-white' : 'border border-border hover:bg-muted'}`}>Reject</button>
      </div>

      {mode === 'approve' ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium">PO number *
              <input className={`${inputCls} mt-1`} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} maxLength={60} />
            </label>
            <label className="text-xs font-medium">PO date *
              <input type="date" className={`${inputCls} mt-1`} value={poDate} max={today} onChange={(e) => setPoDate(e.target.value)} />
            </label>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium">PO document *</div>
            <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.currentTarget.value = '' }} />
            <button type="button" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted" onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /> {file ? 'Change the file' : 'Attach the PO'}</button>
            {file && <span className="ml-2 text-sm">{file.name}</span>}
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
            disabled={pending || !poNumber.trim() || !poDate || !file} onClick={approve}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve the PO
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-xs font-medium">Reason for rejecting *
            <textarea className={`${inputCls} mt-1`} rows={3} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p className="text-xs text-muted-foreground">The ticket will be cancelled (the store can reopen it within 48 hours) and the OEM gets a short note.</p>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            disabled={pending || reason.trim().length < 5} onClick={reject}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject the PO
          </button>
        </div>
      )}
    </div>
  )
}
