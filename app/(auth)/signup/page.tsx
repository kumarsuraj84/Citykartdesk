'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Building2, User, Mail, Lock, ArrowRight, CheckCircle2, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signupOrg } from '@/lib/actions/signup'

const schema = z.object({
  org_name: z.string().min(2, 'Organization name must be at least 2 characters'),
  org_slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens'),
  admin_name: z.string().min(2, 'Name must be at least 2 characters'),
  admin_email: z.string().email('Please enter a valid email address'),
  admin_password: z.string().min(8, 'Password must be at least 8 characters'),
})
type Form = z.infer<typeof schema>

const STEPS = [
  { id: 1, label: 'Organization', icon: Building2 },
  { id: 2, label: 'Admin account', icon: User },
  { id: 3, label: 'Done', icon: CheckCircle2 },
]

function slugify(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep]                  = useState(1)
  const [serverError, setServerError]    = useState<string | null>(null)
  const [isPending, startTransition]     = useTransition()
  const [done, setDone]                  = useState(false)

  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      org_name: '',
      org_slug: '',
      admin_name: '',
      admin_email: '',
      admin_password: '',
    },
    mode: 'onTouched',
  })

  async function goNext() {
    const fields: (keyof Form)[] =
      step === 1 ? ['org_name', 'org_slug'] : ['admin_name', 'admin_email', 'admin_password']

    const valid = await form.trigger(fields)
    if (valid) setStep(step + 1)
  }

  function handleOrgNameChange(val: string) {
    form.setValue('org_name', val)
    if (!form.formState.dirtyFields.org_slug) {
      form.setValue('org_slug', slugify(val))
    }
  }

  function handleSubmit(data: Form) {
    setServerError(null)
    const fd = new FormData()
    Object.entries(data).forEach(([k, v]) => fd.set(k, v))
    startTransition(async () => {
      const result = await signupOrg(fd)
      if (result?.error) {
        setServerError(result.error)
      } else {
        setDone(true)
      }
    })
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-green-500/10 mx-auto">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">You're all set!</h1>
            <p className="text-sm text-muted-foreground">
              Your CognixDesk workspace is ready. Sign in to get started — your 14-day trial is
              active.
            </p>
          </div>
          <Button className="w-full" onClick={() => router.push('/login')}>
            Sign in to your workspace
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">

        {/* Header */}
        <div className="space-y-2 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground text-xl font-bold">
            F
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Start your free trial</h1>
          <p className="text-sm text-muted-foreground">14 days free. No credit card required.</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                  step === s.id
                    ? 'bg-primary text-primary-foreground'
                    : step > s.id
                    ? 'bg-green-500 text-white'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {step > s.id ? '✓' : s.id}
              </div>
              <span
                className={`text-xs font-medium ${
                  step === s.id ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <ChevronRight className="h-3 w-3 text-muted-foreground/40 ml-1" />
              )}
            </div>
          ))}
        </div>

        {/* Form card */}
        <div className="rounded-lg border bg-card shadow-sm p-6 space-y-4">
          {serverError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="org_name">Organization name</Label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="org_name"
                    placeholder="Acme Corp"
                    className="pl-9"
                    {...form.register('org_name')}
                    onChange={(e) => handleOrgNameChange(e.target.value)}
                  />
                </div>
                {form.formState.errors.org_name && (
                  <p className="text-xs text-destructive">{form.formState.errors.org_name.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="org_slug">Workspace URL</Label>
                <div className="flex items-center rounded-lg border border-border overflow-hidden focus-within:ring-2 focus-within:ring-ring">
                  <span className="px-3 py-2 text-xs text-muted-foreground bg-muted border-r border-border whitespace-nowrap">
                    cognixdesk.app/
                  </span>
                  <input
                    id="org_slug"
                    placeholder="acme"
                    className="flex-1 px-3 py-2 text-sm bg-background outline-none"
                    {...form.register('org_slug')}
                  />
                </div>
                {form.formState.errors.org_slug && (
                  <p className="text-xs text-destructive">{form.formState.errors.org_slug.message}</p>
                )}
              </div>

              <Button type="button" className="w-full" onClick={goNext}>
                Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {step === 2 && (
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="admin_name">Your name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="admin_name" placeholder="Jane Smith" className="pl-9" {...form.register('admin_name')} />
                </div>
                {form.formState.errors.admin_name && (
                  <p className="text-xs text-destructive">{form.formState.errors.admin_name.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="admin_email">Work email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="admin_email" type="email" placeholder="jane@company.com" className="pl-9" {...form.register('admin_email')} />
                </div>
                {form.formState.errors.admin_email && (
                  <p className="text-xs text-destructive">{form.formState.errors.admin_email.message}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="admin_password">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input id="admin_password" type="password" placeholder="Min. 8 characters" className="pl-9" {...form.register('admin_password')} />
                </div>
                {form.formState.errors.admin_password && (
                  <p className="text-xs text-destructive">{form.formState.errors.admin_password.message}</p>
                )}
              </div>

              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button type="submit" className="flex-1" disabled={isPending}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create workspace'}
                </Button>
              </div>

              <p className="text-center text-xs text-muted-foreground">
                By signing up, you agree to our{' '}
                <Link href="/legal/terms" className="underline hover:text-foreground">Terms</Link>
                {' '}and{' '}
                <Link href="/legal/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
              </p>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Already have an account?{' '}
          <Link href="/login" className="underline hover:text-foreground">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
