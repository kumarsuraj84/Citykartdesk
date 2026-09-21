'use client'

import { Suspense, useState, useTransition } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Mail, ArrowRight, CheckCircle2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BrandLogo } from '@/components/layout/BrandLogo'
import { forgotPassword } from '@/lib/actions/auth'

const schema = z.object({
  email: z.string().email('Please enter a valid email address'),
})
type Form = z.infer<typeof schema>

function ForgotPasswordForm() {
  const [sent, setSent] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const linkExpired = useSearchParams().get('expired') === '1'

  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  })

  function handleSubmit(data: Form) {
    setServerError(null)
    const fd = new FormData()
    fd.set('email', data.email)
    startTransition(async () => {
      const result = await forgotPassword(fd)
      if (result?.error) {
        setServerError(result.error)
      } else {
        setSent(true)
      }
    })
  }

  if (sent) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center space-y-4">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
        <div className="space-y-1">
          <p className="font-semibold text-lg">Check your email</p>
          <p className="text-sm text-muted-foreground">
            We sent a password reset link to{' '}
            <span className="font-medium text-foreground">{form.getValues('email')}</span>.
            It expires in 1 hour.
          </p>
        </div>
        <Button variant="ghost" size="sm" render={<Link href="/login" />}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Back to sign in
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card shadow-sm p-6 space-y-4">
      {linkExpired && !serverError && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          That link has expired or was already used. Enter your email to get a new one.
        </p>
      )}
      {serverError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {serverError}
        </div>
      )}

      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email address</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              className="pl-9"
              {...form.register('email')}
            />
          </div>
          {form.formState.errors.email && (
            <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              Send reset link
              <ArrowRight className="ml-2 h-4 w-4" />
            </>
          )}
        </Button>
      </form>

      <div className="text-center">
        <Link href="/login" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="inline mr-1 h-3 w-3" />
          Back to sign in
        </Link>
      </div>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-4 text-center">
          <BrandLogo height={110} className="justify-center" priority />
          <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        <Suspense fallback={<div className="rounded-lg border bg-card shadow-sm h-[200px] animate-pulse" />}>
          <ForgotPasswordForm />
        </Suspense>
      </div>
    </div>
  )
}
