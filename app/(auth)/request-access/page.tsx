'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { Loader2, ArrowRight, CheckCircle2, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

const step1Schema = z.object({
  full_name: z.string().min(2, 'Please enter your full name'),
  email: z.string().email('Please enter a valid work email'),
})

const step2Schema = z.object({
  company_name: z.string().min(1, 'Please enter your company name'),
  company_size: z.string().min(1, 'Please select a company size'),
  use_case: z.string().optional(),
})

type Step1Form = z.infer<typeof step1Schema>
type Step2Form = z.infer<typeof step2Schema>

const COMPANY_SIZES = ['1-50', '51-200', '201-500', '501+']

export default function RequestAccessPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [step1Data, setStep1Data] = useState<Step1Form | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const form1 = useForm<Step1Form>({
    resolver: zodResolver(step1Schema),
    defaultValues: { full_name: '', email: '' },
  })

  const form2 = useForm<Step2Form>({
    resolver: zodResolver(step2Schema),
    defaultValues: { company_name: '', company_size: '', use_case: '' },
  })

  function handleStep1(data: Step1Form) {
    setStep1Data(data)
    setStep(2)
  }

  function handleStep2(data: Step2Form) {
    if (!step1Data) return
    setServerError(null)

    startTransition(async () => {
      try {
        const supabase = createClient()
        const { error } = await (supabase as any).from('org_signup_requests').insert({
          full_name: step1Data.full_name,
          email: step1Data.email,
          company_name: data.company_name,
          company_size: data.company_size,
          use_case: data.use_case || null,
        })
        if (error) throw error
        setStep(3)
      } catch (err: any) {
        setServerError(err?.message ?? 'Something went wrong. Please try again.')
      }
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">

        {/* Logo + heading */}
        <div className="space-y-2 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground text-xl font-bold">
            F
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Request access</h1>
          <p className="text-sm text-muted-foreground">
            Tell us a bit about yourself and your team
          </p>
        </div>

        {/* Step indicators */}
        {step !== 3 && (
          <div className="flex items-center gap-2">
            {[1, 2].map((s) => (
              <div key={s} className="flex flex-1 items-center gap-2">
                <div
                  className={`h-2 flex-1 rounded-full transition-colors ${
                    s <= step ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              </div>
            ))}
          </div>
        )}

        {/* Step 1 */}
        {step === 1 && (
          <div className="rounded-lg border bg-card shadow-sm">
            <div className="p-6 space-y-1.5 border-b">
              <p className="text-sm font-medium">Step 1 of 2 — Your details</p>
            </div>
            <div className="p-6">
              <form onSubmit={form1.handleSubmit(handleStep1)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="full_name">Full name</Label>
                  <Input
                    id="full_name"
                    placeholder="Jane Smith"
                    {...form1.register('full_name')}
                  />
                  {form1.formState.errors.full_name && (
                    <p className="text-xs text-destructive">{form1.formState.errors.full_name.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email">Work email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    {...form1.register('email')}
                  />
                  {form1.formState.errors.email && (
                    <p className="text-xs text-destructive">{form1.formState.errors.email.message}</p>
                  )}
                </div>

                <Button type="submit" className="w-full">
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </form>
            </div>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="rounded-lg border bg-card shadow-sm">
            <div className="p-6 space-y-1.5 border-b">
              <p className="text-sm font-medium">Step 2 of 2 — Your company</p>
            </div>
            <div className="p-6">
              {serverError && (
                <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {serverError}
                </div>
              )}
              <form onSubmit={form2.handleSubmit(handleStep2)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="company_name">Company name</Label>
                  <Input
                    id="company_name"
                    placeholder="Acme Corp"
                    {...form2.register('company_name')}
                  />
                  {form2.formState.errors.company_name && (
                    <p className="text-xs text-destructive">{form2.formState.errors.company_name.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="company_size">Company size</Label>
                  <select
                    id="company_size"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    {...form2.register('company_size')}
                  >
                    <option value="">Select size…</option>
                    {COMPANY_SIZES.map((s) => (
                      <option key={s} value={s}>{s} employees</option>
                    ))}
                  </select>
                  {form2.formState.errors.company_size && (
                    <p className="text-xs text-destructive">{form2.formState.errors.company_size.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="use_case">
                    Use case <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <textarea
                    id="use_case"
                    rows={3}
                    placeholder="Briefly describe how you plan to use CognixDesk…"
                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                    {...form2.register('use_case')}
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setStep(1)}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back
                  </Button>
                  <Button type="submit" className="flex-1" disabled={isPending}>
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        Submit
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Step 3 — success */}
        {step === 3 && (
          <div className="rounded-lg border bg-card p-6 text-center space-y-3">
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
            <div className="space-y-1">
              <p className="font-medium">Request submitted!</p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Your request has been submitted. We&apos;ll review it and get back to you within 24 hours.
              </p>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="text-foreground hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
