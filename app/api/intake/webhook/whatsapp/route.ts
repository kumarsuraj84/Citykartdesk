import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyWebhookChallenge } from '@/lib/whatsapp/config'
import { processWhatsAppWebhookPayload } from '@/lib/whatsapp/webhook-handler'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any; storage: any }

/**
 * Step 3 — Meta's webhook-verification handshake. Meta calls this once when
 * the callback URL is registered (and occasionally on re-verification) with
 * hub.mode=subscribe, hub.verify_token, and hub.challenge. Only an exact
 * verify-token match (against an active channel's stored secret) may echo
 * the challenge back; anything else is rejected outright.
 */
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode')
  const token = req.nextUrl.searchParams.get('hub.verify_token')
  const challenge = req.nextUrl.searchParams.get('hub.challenge')

  const admin = createAdminClient() as unknown as AnyClient
  const verified = await verifyWebhookChallenge(admin, mode, token)
  if (!verified || !challenge) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  return new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain' } })
}

/**
 * Step 4/5/16 — inbound message/status delivery. The raw body is read
 * BEFORE any JSON parsing because Meta's X-Hub-Signature-256 is an
 * HMAC-SHA256 over the exact bytes sent; verification must succeed before
 * anything in the payload is acted on (Step 4: "Do not process inbound
 * messages before verification succeeds").
 *
 * Response codes follow this repo's existing webhook convention (Gmail/
 * Outlook routes): once past signature verification, always return 200 —
 * even for a malformed/unsupported payload — since Meta (like Gmail/
 * Outlook) retries non-2xx responses, and a payload that will never become
 * processable should not trigger a retry storm. An INVALID signature is the
 * one case that fails closed with a non-200, per Step 4's explicit
 * instruction, since retrying an unauthenticated request costs nothing and
 * a 200 there could be read as confirming the endpoint accepts unsigned
 * traffic.
 */
// A real Meta delivery is a few kilobytes. Anything larger is refused before it is read into memory or parsed (audit D-061).
const MAX_BODY_BYTES = 1_048_576
// Signature verification needs the channel's secret, so each request costs a database and Vault read before it can be rejected. One caller address
// may therefore make only this many requests a minute (Meta's deliveries to one address are far below it). Only applied when the caller's address
// is trustworthy (TRUSTED_PROXY_HOPS), exactly as for sign-in limits.
export const MAX_REQUESTS_PER_MINUTE_PER_CALLER = 1200

export async function POST(req: NextRequest) {
  const ip = await getClientIp()
  if (ip && (await rateLimit(`wa-webhook:${ip}`, MAX_REQUESTS_PER_MINUTE_PER_CALLER, 60_000)).limited) {
    return NextResponse.json({ error: 'too many requests' }, { status: 429 })
  }
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return NextResponse.json({ error: 'payload too large' }, { status: 413 })
  const rawBody = await req.text()
  if (rawBody.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'payload too large' }, { status: 413 })
  const signatureHeader = req.headers.get('x-hub-signature-256')

  const admin = createAdminClient() as unknown as AnyClient
  const { outcome } = await processWhatsAppWebhookPayload({ admin, rawBody, signatureHeader })

  if (outcome.kind === 'invalid_signature') {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}
