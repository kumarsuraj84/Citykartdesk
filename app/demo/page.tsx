'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function DemoPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'signing-in' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function autoLogin() {
      const supabase = createClient()
      setStatus('signing-in')

      // Sign out any existing session first
      await supabase.auth.signOut()

      const { error } = await supabase.auth.signInWithPassword({
        email: 'demo@cognixdesk.com',
        password: 'Demo@CognixDesk123!',
      })

      if (error) {
        setError(error.message)
        setStatus('error')
        return
      }

      // Redirect to the main home page
      router.replace('/home')
    }

    autoLogin()
  }, [router])

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center max-w-sm mx-auto px-6">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-foreground mb-2">Demo unavailable</h1>
          <p className="text-sm text-muted-foreground mb-6">{error}</p>
          <a href="/login" className="text-sm text-primary hover:underline">Back to login</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto mb-4" />
        <p className="text-sm font-medium text-muted-foreground">
          {status === 'loading' ? 'Preparing demo…' : 'Signing you in…'}
        </p>
      </div>
    </div>
  )
}
