'use client'

import { Suspense, useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { Loader2, Mail, Lock, ArrowRight, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signInWithPassword, signInWithMagicLink } from '@/lib/actions/auth'

const passwordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const magicLinkSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
})

type PasswordForm = z.infer<typeof passwordSchema>
type MagicLinkForm = z.infer<typeof magicLinkSchema>

function LoginForm() {
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [serverError, setServerError] = useState<string | null>(null)
  const [magicSent, setMagicSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  const callbackError = searchParams.get('error')

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { email: '', password: '' },
  })

  const magicForm = useForm<MagicLinkForm>({
    resolver: zodResolver(magicLinkSchema),
    defaultValues: { email: '' },
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

  function handleMagicSubmit(data: MagicLinkForm) {
    setServerError(null)
    const formData = new FormData()
    formData.set('email', data.email)

    startTransition(async () => {
      const result = await signInWithMagicLink(formData)
      if (result?.error) {
        setServerError(result.error)
      } else {
        setMagicSent(true)
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

      {/* Magic link success */}
      {magicSent ? (
        <div className="rounded-lg border bg-card p-6 text-center space-y-3">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
          <div className="space-y-1">
            <p className="font-medium">Check your email</p>
            <p className="text-sm text-muted-foreground">
              We sent a sign-in link to{' '}
              <span className="font-medium text-foreground">
                {magicForm.getValues('email')}
              </span>
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setMagicSent(false); setMode('password') }}
          >
            Back to sign in
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card shadow-sm">
          {/* Mode toggle */}
          <div className="flex border-b">
            <button
              onClick={() => { setMode('password'); setServerError(null) }}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                mode === 'password'
                  ? 'border-b-2 border-primary text-foreground -mb-px'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Password
            </button>
            <button
              onClick={() => { setMode('magic'); setServerError(null) }}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                mode === 'magic'
                  ? 'border-b-2 border-primary text-foreground -mb-px'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Magic link
            </button>
          </div>

          <div className="p-6">
            {/* Server error */}
            {serverError && (
              <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {serverError}
              </div>
            )}

            {mode === 'password' ? (
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
                      placeholder="you@company.com"
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
                  <div className="text-right">
                    <Link
                      href="/forgot-password"
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Forgot password?
                    </Link>
                  </div>
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
            ) : (
              <form
                onSubmit={magicForm.handleSubmit(handleMagicSubmit)}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="magic-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="magic-email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      className="pl-9"
                      {...magicForm.register('email')}
                    />
                  </div>
                  {magicForm.formState.errors.email && (
                    <p className="text-xs text-destructive">
                      {magicForm.formState.errors.email.message}
                    </p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  We&apos;ll send a sign-in link to your email. No password needed.
                </p>
                <Button type="submit" className="w-full" disabled={isPending}>
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Send magic link
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">

        {/* Logo + heading */}
        <div className="space-y-2 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground text-xl font-bold">
            F
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to CognixDesk</h1>
          <p className="text-sm text-muted-foreground">
            Your company&apos;s service management platform
          </p>
        </div>

        <Suspense fallback={
          <div className="rounded-lg border bg-card shadow-sm h-[280px] animate-pulse" />
        }>
          <LoginForm />
        </Suspense>

        <p className="text-center text-xs text-muted-foreground">
          Having trouble signing in? Contact your IT administrator.
        </p>

        <p className="text-center text-xs text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/request-access" className="text-foreground hover:underline">
            Request access
          </Link>
        </p>

        <p className="text-center text-xs text-muted-foreground">
          Want to explore first?{' '}
          <Link href="/demo" className="text-primary font-medium hover:underline">
            Try the live demo →
          </Link>
        </p>
      </div>
    </div>
  )
}
