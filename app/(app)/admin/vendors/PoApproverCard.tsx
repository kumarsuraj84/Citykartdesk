'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setPoApprover } from '@/lib/actions/admin/vendors'

// The organisation-wide default person who decides a vendor's quote / purchase order when nothing more specific names one. It used to be set on the built-in AC screen of
// Vendor Programs; it lives here now. (A Vendor Program has its own default approvers on its own screen; the AC sheet column "Quote Approver Mail To" comes first of all.)

export function PoApproverCard({ staff, approverId }: { staff: { id: string; full_name: string; role: string }[]; approverId: string }) {
  const router = useRouter()
  const [approver, setApprover] = useState(approverId)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold text-foreground">Default PO approver</h2>
      <p className="mb-2 text-xs text-muted-foreground">
        When a vendor sends a quote, it goes to the approvers named in the AC sheet column Quote Approver Mail To (any one decides), or to the default approvers of the Vendor Program
        (Admin &gt; Vendor Programs). If nobody is named there, it goes to the person chosen here. Without any person a vendor cannot ask for a PO.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Default PO approver" value={approver} disabled={pending}
          onChange={(e) => {
            const v = e.target.value
            setApprover(v)
            start(async () => {
              const r = await setPoApprover(v)
              setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' })
              if (!r.error) router.refresh()
            })
          }}
          className="h-9 min-w-[14rem] rounded-lg border border-border bg-background px-3 text-sm"
        >
          {!approver && <option value="">Not set - choose a person</option>}
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        {msg && <span role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-xs text-emerald-700' : 'text-xs text-red-600'}>{msg.text}</span>}
      </div>
    </section>
  )
}
