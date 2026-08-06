import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exchangeCode, providerConfig, verifyState } from '@/lib/intake/oauth'
import { setupGmailWatch } from '@/lib/intake/gmail-api'
import { createGraphSubscription } from '@/lib/intake/graph-api'

// GET /api/intake/oauth/callback?code=...&state=...
// Exchanges the auth code for a refresh token, stores OAuth credentials in
// Vault, then arms the channel for native API push (Gmail watch or Graph
// subscription). Falls back gracefully to IMAP polling if push env vars are absent.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const back = (q: string) => NextResponse.redirect(new URL(`/intake/channels?${q}`, origin))

  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.redirect(new URL('/login', origin))

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const providerError = req.nextUrl.searchParams.get('error')
  if (providerError) return back('oauth=denied')
  if (!code || !state) return back('oauth=badrequest')

  const verified = verifyState(state)
  if (!verified) return back('oauth=badstate')
  const { channelId, provider } = verified

  // Re-check ownership — state is signed but the session must still own the channel.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rls = (await createClient()) as unknown as { from: (t: string) => any }
  const { data: channel } = await rls
    .from('intake_channels')
    .select('id, config')
    .eq('id', channelId)
    .eq('org_id', profile.org_id)
    .maybeSingle()
  if (!channel) return back('oauth=notfound')

  const redirectUri = `${process.env.OAUTH_REDIRECT_BASE_URL ?? origin}/api/intake/oauth/callback`
  const result = await exchangeCode({ provider, code, redirectUri })
  if ('error' in result) return back('oauth=exchangefailed')
  if (!result.email) return back('oauth=noemail')

  const cfg = providerConfig(provider)
  const secret = JSON.stringify({
    type:          'oauth',
    provider,
    host:          cfg.imapHost,
    port:          cfg.imapPort,
    secure:        true,
    user:          result.email,
    refresh_token: result.refreshToken,
  })

  // Store via service-role RPC (authenticated cannot execute it).
  const admin = createAdminClient() as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (t: string) => any
  }
  const { error: vaultErr } = await admin.rpc('intake_store_credential', {
    p_channel_id: channelId,
    p_secret:     secret,
  })
  if (vaultErr) return back('oauth=vaultfailed')

  // ── Push registration ──────────────────────────────────────────────────────
  // Try to set up native API push notifications. If the required env vars are
  // missing the channel falls back to the existing IMAP polling path automatically.
  const baseUrl = process.env.OAUTH_REDIRECT_BASE_URL ?? origin
  const workerSecret = process.env.INTAKE_WORKER_SECRET ?? process.env.CRON_SECRET ?? ''
  let pushConfig: Record<string, unknown> = {}

  if (provider === 'google') {
    const pubsubTopic = process.env.GOOGLE_PUBSUB_TOPIC
    if (pubsubTopic && result.accessToken) {
      const watch = await setupGmailWatch(result.email, result.accessToken, pubsubTopic)
      if (!('error' in watch)) {
        pushConfig = {
          push_mode:              true,
          last_history_id:        watch.historyId,
          gmail_watch_expiration: watch.expiration,
        }
      }
    }
  } else if (provider === 'microsoft') {
    if (workerSecret && result.accessToken) {
      const notificationUrl = `${baseUrl}/api/intake/webhook/outlook?token=${encodeURIComponent(workerSecret)}`
      const sub = await createGraphSubscription({
        accessToken:     result.accessToken,
        notificationUrl,
        clientState:     workerSecret,
      })
      if (!('error' in sub)) {
        pushConfig = {
          push_mode:                    true,
          graph_subscription_id:        sub.id,
          graph_subscription_expiration: sub.expirationDateTime,
        }
      }
    }
  }

  // Arm the channel: record the connected address + provider, clear any stale
  // error, activate, and merge push config (empty object = IMAP polling path).
  await rls
    .from('intake_channels')
    .update({
      provider: provider === 'google' ? 'gmail' : 'm365',
      status:   'active',
      last_error: null,
      config: {
        ...(channel.config ?? {}),
        host:   cfg.imapHost,
        user:   result.email,
        folder: (channel.config?.folder as string | undefined) ?? 'INBOX',
        ...pushConfig,
      },
    })
    .eq('id', channelId)
    .eq('org_id', profile.org_id)

  const mode = pushConfig.push_mode ? 'push' : 'polling'
  return back(`oauth=connected&mode=${mode}`)
}
