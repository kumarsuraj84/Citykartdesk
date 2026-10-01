'use client'

import { AlertTriangle } from 'lucide-react'

/** A plain "OK-only" popup for something the user needs to actively
 *  acknowledge (not just a toast they might miss) — e.g. a rejected
 *  attachment they need to go fix before they can continue. */
export function AlertModal({ title, message, onOk }: {
  title: string
  message: string
  onOk: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex items-start gap-3 px-4 pt-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{message}</p>
          </div>
        </div>
        <div className="flex justify-end px-4 pb-4 pt-3">
          <button type="button" onClick={onOk} className="btn-gradient px-4 py-1.5 text-xs">
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
