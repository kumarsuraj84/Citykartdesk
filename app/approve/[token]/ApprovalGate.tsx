'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, ShieldCheck } from 'lucide-react'
import { requestApprovalCode, verifyApprovalCode } from '@/lib/actions/approvalEmail'

/** Shown to a visitor who is not signed in: prove you are the person this approval was sent to. */
export function ApprovalGate({ token, approverName, requestNo, signInHref }: { token: string; approverName: string; requestNo: string; signInHref: string }) {
  const router = useRouter()
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const sendCode = () => {
    setError(null)
    start(async () => {
      const r = await requestApprovalCode(token)
      if (r.error) setError(r.error)
      else setSentTo(r.sentTo ?? 'your e-mail')
    })
  }
  const verify = () => {
    if (!code.trim()) { setError('Enter the 6-digit code from the e-mail.'); return }
    setError(null)
    start(async () => {
      const r = await verifyApprovalCode(token, code)
      if (r.error) setError(r.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted"><ShieldCheck className="h-6 w-6 text-muted-foreground" /></div>
        <h1 className="text-lg font-semibold tracking-tight">Approval for {requestNo}</h1>
        <p className="text-sm text-muted-foreground">This request was sent for approval to <strong className="text-foreground">{approverName}</strong>. Only {approverName} can approve or reject it, so we need to confirm it is you.</p>
      </div>

      {!sentTo ? (
        <div className="space-y-2">
          <button type="button" onClick={sendCode} disabled={pending} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            <Mail className="h-4 w-4" />{pending ? 'Sending…' : `E-mail me a code`}
          </button>
          <p className="text-center text-xs text-muted-foreground">The code goes only to {approverName}&apos;s own e-mail address.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor="apv-code" className="text-sm font-medium">Enter the 6-digit code we sent to {sentTo}</label>
          <input id="apv-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-center text-xl tracking-[0.4em] outline-none focus:ring-2 focus:ring-primary/30" />
          <button type="button" onClick={verify} disabled={pending} className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? 'Checking…' : 'Confirm it is me'}</button>
          <button type="button" onClick={sendCode} disabled={pending} className="w-full text-xs font-medium text-primary hover:underline">Send a new code</button>
        </div>
      )}

      <div className="border-t border-border pt-3 text-center text-sm">
        <a href={signInHref} className="font-semibold text-primary hover:underline">Sign in to Citykart Desk instead</a>
      </div>
      {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
    </div>
  )
}
