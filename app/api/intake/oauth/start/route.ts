import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createClient } from '@/lib/supabase/server'
import { providerConfig, signState, type OAuthProvider } from '@/lib/intake/oauth'

// GET /api/intake/oauth/start?channel=<id>&provider=google|microsoft
// Admin-only. Builds the provider consent URL with signed state and redirects.
export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.redirect(new URL('/login', req.nextUrl.origin))
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') {
    return NextResponse.redirect(new URL('/intake/channels?oauth=forbidden', req.nextUrl.origin))
  }

  const channelId = req.nextUrl.searchParams.get('channel')
  const provider = req.nextUrl.searchParams.get('provider') as OAuthProvider | null
  if (!channelId || (provider !== 'google' && provider !== 'microsoft')) {
    return NextResponse.redirect(new URL('/intake/channels?oauth=badrequest', req.nextUrl.origin))
  }

  // Verify the channel belongs to the caller's org (RLS-scoped read).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as unknown as { from: (t: string) => any }
  const { data: channel } = await supabase
    .from('intake_channels')
    .select('id')
    .eq('id', channelId)
    .eq('org_id', profile.org_id)
    .maybeSingle()
  if (!channel) {
    return NextResponse.redirect(new URL('/intake/channels?oauth=notfound', req.nextUrl.origin))
  }

  const cfg = providerConfig(provider)
  if (!cfg.clientId) {
    return NextResponse.redirect(new URL('/intake/channels?oauth=unconfigured', req.nextUrl.origin))
  }

  const redirectUri = `${process.env.OAUTH_REDIRECT_BASE_URL ?? req.nextUrl.origin}/api/intake/oauth/callback`
  const params = new URLSearchParams({
    client_id:     cfg.clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         cfg.scopes,
    state:         signState({ channelId, provider }),
    ...cfg.authorizeExtra,
  })

  return NextResponse.redirect(`${cfg.authorizeUrl}?${params.toString()}`)
}
