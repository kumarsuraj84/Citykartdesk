import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { oauthStateConfigured, providerConfig, signState } from '@/lib/intake/oauth'
import { SHEETS_SCOPE } from '@/lib/masters/google'

// GET /api/masters/oauth/start
// Administrator only. Sends the signed-in administrator to Google to allow VIEW-ONLY access to spreadsheets for the Google account they sign in with
// (CK Desk uses citykartdesk@citykartstores.com). The return goes through the same registered address as the mailbox connection.
export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.redirect(new URL('/login', req.nextUrl.origin))
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') return NextResponse.redirect(new URL('/admin/masters?google=forbidden', req.nextUrl.origin))

  const cfg = providerConfig('google')
  if (!cfg.clientId || !oauthStateConfigured()) return NextResponse.redirect(new URL('/admin/masters?google=unconfigured', req.nextUrl.origin))

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: `${process.env.OAUTH_REDIRECT_BASE_URL || req.nextUrl.origin}/api/intake/oauth/callback`,
    response_type: 'code',
    scope: `${SHEETS_SCOPE} openid email`,
    state: signState({ channelId: 'masters', provider: 'google', userId: profile.id }),
    ...cfg.authorizeExtra,
  })
  return NextResponse.redirect(`${cfg.authorizeUrl}?${params.toString()}`)
}
