import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { exchangeCode, providerConfig, verifyState } from '@/lib/intake/oauth'
import { setupGmailWatch } from '@/lib/intake/gmail-api'
import { createGraphSubscription } from '@/lib/intake/graph-api'
import { getSecret } from '@/lib/secrets'

// GET /api/intake/oauth/callback?code=...&state=...
// Exchanges the auth code for a refresh token, stores OAuth credentials in
// Vault, then arms the channel for native API push (Gmail watch or Graph
// subscription). Falls back gracefully to IMAP polling if push env vars are absent.
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const back = (q: string) => NextResponse.redirect(new URL(`/intake/channels?${q}`, origin))

  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.redirect(new URL('/login', origin))
  // D-059: connecting a mailbox is an administrator action, checked again here and not only when the flow was started
  if (profile.role !== 'admin' && profile.role !== 'platform_owner') return back('oauth=forbidden')

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const providerError = req.nextUrl.searchParams.get('error')
  if (providerError) return back('oauth=denied')
  if (!code || !state) return back('oauth=badrequest')

  const verified = verifyState(state)
  if (!verified) return back('oauth=badstate')
  const { channelId, provider } = verified
  // D-059: the state belongs to the administrator who started the flow; another signed-in user cannot complete it (login-CSRF / pasted callback link)
  if (verified.userId !== profile.id) return back('oauth=badstate')

  // "Connect Google Sheets" (master data) uses this same registered return address; its state carries channelId "masters" instead of a mailbox channel.
  if (channelId === 'masters') {
    const mastersBack = (q: string) => NextResponse.redirect(new URL(`/admin/masters?${q}`, origin))
    const redirect = `${process.env.OAUTH_REDIRECT_BASE_URL ?? origin}/api/intake/oauth/callback`
    const exchanged = await exchangeCode({ provider: 'google', code, redirectUri: redirect })
    if ('error' in exchanged) return mastersBack('google=exchangefailed')
    const store = createAdminClient() as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: (t: string) => any
    }
    const saved = await store.rpc('masters_store_credential', { p_org: profile.org_id, p_secret: JSON.stringify({ provider: 'google', refresh_token: exchanged.refreshToken, account: exchanged.email }) })
    if (saved.error || !saved.data) return mastersBack('google=vaultfailed')
    const up = await store.from('master_google_connection').upsert(
      { org_id: profile.org_id, account_email: exchanged.email, secret_ref: saved.data, status: 'connected', last_error: null, connected_at: new Date().toISOString(), connected_by: profile.id },
      { onConflict: 'org_id' },
    )
    if (up.error) return mastersBack('google=savefailed')
    return mastersBack('google=connected')
  }

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
  // Dedicated to this public URL/clientState — see the matching comment in
  // app/api/intake/webhook/outlook/route.ts for why this is deliberately
  // not INTAKE_WORKER_SECRET (that one grants full worker-admin access and
  // shouldn't sit in a URL query string).
  const workerSecret = getSecret('intake_webhook') ?? ''
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
      const notificationUrl = `${baseUrl}/api/intake/webhook/outlook`      // no secret in the address (VAPT-030): clientState carries it
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
