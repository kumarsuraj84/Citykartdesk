'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

export default function OwnerLoginPage() {
  const router = useRouter()
  const [secret, setSecret] = useState('')
  const [show,   setShow]   = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const [isPending, start]  = useTransition()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    start(async () => {
      const res = await fetch('/api/owner/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret }),
      })
      if (res.ok) {
        toast.success('Access granted')
        router.replace('/owner/orgs')
      } else {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? 'Invalid credentials')
      }
    })
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 text-foreground antialiased overflow-hidden bg-background">
      {/* Ambient backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(110%_110%_at_0%_0%,rgba(13,148,136,0.14),transparent_45%),radial-gradient(110%_110%_at_100%_0%,rgba(79,70,229,0.12),transparent_45%),radial-gradient(130%_130%_at_50%_100%,rgba(56,189,248,0.10),transparent_50%)]" />
      {/* Grid */}
      <div className="pointer-events-none absolute inset-0 -z-10 opacity-[0.35] [background-image:linear-gradient(to_right,rgba(15,23,42,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.05)_1px,transparent_1px)] [background-size:38px_38px]" />

      <div className="w-full max-w-sm space-y-7">
        {/* Branding */}
        <div className="text-center">
          <div className="inline-grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-indigo-600 shadow-xl shadow-emerald-500/25 mb-5">
            <ShieldCheck className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">CognixDesk Control</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Platform owner — sign in to continue</p>
        </div>

        <div className="rounded-2xl border border-border bg-card backdrop-blur-xl p-6 shadow-xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="owner-secret" className="text-sm font-medium">Portal password</label>
              <div className="relative">
                <input
                  id="owner-secret"
                  type={show ? 'text' : 'password'}
                  value={secret}
                  onChange={e => setSecret(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm pr-10 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShow(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={show ? 'Hide' : 'Show'}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {error && <p className="text-xs text-red-500">{error}</p>}
            </div>

            <button
              type="submit"
              disabled={isPending || !secret}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-indigo-600 text-white text-sm font-semibold shadow-lg shadow-emerald-500/20 disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in to Control Center
            </button>
          </form>
        </div>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Restricted to platform administrators only.
        </p>
      </div>
    </div>
  )
}
