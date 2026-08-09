'use client'

import { Suspense, useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Mail, Lock, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BrandLogo } from '@/components/layout/BrandLogo'
import { signInWithPassword } from '@/lib/actions/auth'

const passwordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

type PasswordForm = z.infer<typeof passwordSchema>

function LoginForm() {
  const searchParams = useSearchParams()
  const [serverError, setServerError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const callbackError = searchParams.get('error')

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { email: '', password: '' },
  })

  function handlePasswordSubmit(data: PasswordForm) {
    setServerError(null)
    const formData = new FormData()
    formData.set('email', data.email)
    formData.set('password', data.password)

    startTransition(async () => {
      const result = await signInWithPassword(formData)
      if (result?.error) {
        setServerError(result.error)
      }
    })
  }

  return (
    <>
      {/* Error from callback */}
      {callbackError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Authentication failed. Please try again.
        </div>
      )}

      <div className="rounded-lg border bg-card shadow-sm">
        <div className="p-6">
          {/* Server error */}
          {serverError && (
            <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </div>
          )}

          <form
            onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@citykart.org"
                  className="pl-9"
                  {...passwordForm.register('email')}
                />
              </div>
              {passwordForm.formState.errors.email && (
                <p className="text-xs text-destructive">
                  {passwordForm.formState.errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pl-9"
                  {...passwordForm.register('password')}
                />
              </div>
              {passwordForm.formState.errors.password && (
                <p className="text-xs text-destructive">
                  {passwordForm.formState.errors.password.message}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Sign in
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    </>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">

        {/* Logo + heading */}
        <div className="space-y-4 text-center">
          <BrandLogo height={110} className="justify-center" priority />
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to Citykart Desk</h1>
          <p className="text-sm text-muted-foreground">
            Your company&apos;s service management platform
          </p>
        </div>

        <Suspense fallback={
          <div className="rounded-lg border bg-card shadow-sm h-[280px] animate-pulse" />
        }>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
