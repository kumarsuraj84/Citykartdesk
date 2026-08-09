'use client'

import { useEffect, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Lock, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BrandLogo } from '@/components/layout/BrandLogo'
import { resetPassword } from '@/lib/actions/auth'
import { createClient } from '@/lib/supabase/client'

const schema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, {
  message: "Passwords don't match",
  path: ['confirm'],
})
type Form = z.infer<typeof schema>

// Admin-generated invite/recovery links deliver their session as tokens in the
// URL hash fragment (`#access_token=...`), which the server can never see. This
// establishes the session client-side, then clears the hash from the address bar.
function useHashSession() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const hash = window.location.hash
    if (!hash || hash.length < 2) {
      // client-only read of window.location.hash — must run after mount, no server equivalent
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus('ready')
      return
    }

    const params = new URLSearchParams(hash.slice(1))
    const errorDescription = params.get('error_description')
    if (errorDescription) {
      setError(errorDescription.replace(/\+/g, ' '))
      setStatus('error')
      return
    }

    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')
    if (!access_token || !refresh_token) {
      setStatus('ready')
      return
    }

    const supabase = createClient()
    supabase.auth.setSession({ access_token, refresh_token }).then(({ error: sessionError }) => {
      window.history.replaceState(null, '', window.location.pathname)
      if (sessionError) {
        setError(sessionError.message)
        setStatus('error')
      } else {
        setStatus('ready')
      }
    })
  }, [])

  return { status, error }
}

export default function ResetPasswordPage() {
  const [serverError, setServerError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const { status: sessionStatus, error: sessionError } = useHashSession()

  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  })

  function handleSubmit(data: Form) {
    setServerError(null)
    const fd = new FormData()
    fd.set('password', data.password)
    startTransition(async () => {
      const result = await resetPassword(fd)
      if (result?.error) setServerError(result.error)
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-4 text-center">
          <BrandLogo height={110} className="justify-center" priority />
          <h1 className="text-2xl font-semibold tracking-tight">Set new password</h1>
          <p className="text-sm text-muted-foreground">
            Choose a strong password for your account.
          </p>
        </div>

        <div className="rounded-lg border bg-card shadow-sm p-6 space-y-4">
          {sessionStatus === 'checking' ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : sessionStatus === 'error' ? (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {sessionError ?? 'This link is invalid or has expired. Please request a new one.'}
            </div>
          ) : (
            <>
              {serverError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {serverError}
                </div>
              )}

              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">New password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Min. 8 characters"
                      className="pl-9"
                      {...form.register('password')}
                    />
                  </div>
                  {form.formState.errors.password && (
                    <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="confirm"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Re-enter your password"
                      className="pl-9"
                      {...form.register('confirm')}
                    />
                  </div>
                  {form.formState.errors.confirm && (
                    <p className="text-xs text-destructive">{form.formState.errors.confirm.message}</p>
                  )}
                </div>

                <Button type="submit" className="w-full" disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Update password
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
