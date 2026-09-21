import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Landing point for the links in our password-reset / invitation emails.
// GET only shows a "Continue" button; the one-time token is used on POST, so a mail
// scanner that pre-opens the link cannot use it up.

const ALLOWED_TYPES = new Set(['recovery', 'invite'])

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const safeNext = (raw: string | null) => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/reset-password')

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash') ?? ''
  const type = searchParams.get('type') ?? ''
  const next = safeNext(searchParams.get('next'))
  const valid = tokenHash.length > 0 && tokenHash.length < 200 && ALLOWED_TYPES.has(type)

  const body = valid
    ? `<h1>Citykart Desk</h1>
       <p>Press the button to continue and choose your password.</p>
       <form method="POST" action="/auth/confirm">
         <input type="hidden" name="token_hash" value="${esc(tokenHash)}">
         <input type="hidden" name="type" value="${esc(type)}">
         <input type="hidden" name="next" value="${esc(next)}">
         <button type="submit">Continue</button>
       </form>`
    : `<h1>Citykart Desk</h1><p>This link is not valid. Please request a new one from the sign-in page.</p><p><a href="/login">Go to sign in</a></p>`

  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Citykart Desk</title>
     <style>body{font-family:Arial,Helvetica,sans-serif;background:#f4f6fb;color:#1A1F36;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
     .card{background:#fff;border:1px solid #e2e8f4;border-radius:12px;padding:32px;max-width:380px;text-align:center}
     button{background:#1B2559;color:#fff;border:0;border-radius:8px;padding:10px 22px;font-size:14px;cursor:pointer}a{color:#1B2559}</style></head>
     <body><div class="card">${body}</div></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } },
  )
}

export async function POST(request: Request) {
  const form = await request.formData()
  const tokenHash = String(form.get('token_hash') ?? '')
  const type = String(form.get('type') ?? '')
  const next = safeNext(String(form.get('next') ?? ''))
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || new URL(request.url).origin

  if (!tokenHash || !ALLOWED_TYPES.has(type)) return NextResponse.redirect(`${origin}/login`, 303)

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type: type as 'recovery' | 'invite', token_hash: tokenHash })
  if (error) {
    return NextResponse.redirect(`${origin}/forgot-password?expired=1`, 303)
  }
  return NextResponse.redirect(`${origin}${next}`, 303)
}
