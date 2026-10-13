import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeNextPath } from '@/lib/auth/safe-next'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNextPath(searchParams.get('next')) // D-034: in-site paths only

  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  // Admin-generated links (invite/recovery) carry tokens in the URL hash fragment
  // instead of a `code` query param — the server never sees a hash fragment, so
  // forward to `next` regardless and let the client-side page pick it up.
  return NextResponse.redirect(`${origin}${next}`)
}
