import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Fast path: public assets need no session work ──────────────────────────
  // Returning before touching Supabase avoids an auth round-trip per asset request.
  const isPublicAsset =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    /\.(svg|png|jpg|jpeg|gif|webp|ico)$/.test(pathname)
  if (isPublicAsset) return NextResponse.next({ request })

  // ── Fast path: cron/webhook/health API routes authenticate themselves ──────
  // These are called by Railway's cron-tick.mjs, Google Pub/Sub, and Microsoft
  // Graph — none of which carry a Supabase session cookie, so the default
  // "no session → redirect to /login" rule below would otherwise intercept
  // them before their own x-cron-secret / worker-secret / webhook-token check
  // ever runs. Deliberately an exact-match allowlist, not a `/api/*` prefix —
  // every other API route (e.g. /api/admin/audit, /api/intake/oauth/*) must
  // stay under normal session gating.
  const PUBLIC_API_ROUTES = new Set([
    '/api/health',
    '/api/alerts/run',
    '/api/escalation/run',
    '/api/business-rules/run',
    '/api/desktime/sync',
    '/api/intake/cron/classify',
    '/api/intake/webhook/gmail',
    '/api/intake/webhook/outlook',
  ])
  if (PUBLIC_API_ROUTES.has(pathname)) return NextResponse.next({ request })

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Validate + refresh the session. getClaims() verifies the JWT locally (no Auth
  // round-trip) when the project uses asymmetric signing keys, and refreshes the session
  // cookie via getSession() internally. For symmetric (HS256) keys it transparently falls
  // back to getUser(). This is the same trust model as getUser() but faster on every
  // request once asymmetric signing keys are enabled in the Supabase dashboard.
  const { data: claimsData } = await supabase.auth.getClaims()
  const userId = (claimsData?.claims?.sub as string | undefined) ?? null

  const isAuthRoute =
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password')

  // Unauthenticated visitors to '/' or any non-auth route → /login
  if (!userId && !isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    if (pathname !== '/') url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (userId && pathname === '/login') {
    const raw = request.nextUrl.searchParams.get('next') ?? ''
    const next =
      raw.startsWith('/') && !raw.startsWith('//')
        ? raw
        : '/home'
    const url = request.nextUrl.clone()
    url.pathname = next
    url.searchParams.delete('next')
    return NextResponse.redirect(url)
  }

  // Logged-in users hitting the landing page → go to home
  if (userId && pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/home'
    return NextResponse.redirect(url)
  }

  // Forward the already-verified user id to the page/layout render so
  // getCurrentProfile() (lib/queries/profiles.ts) doesn't have to make its own
  // redundant auth round-trip to re-verify the exact same session. `.set()`
  // (not merge) overwrites any client-forged copy of this header on the
  // incoming request — the value here is always ours, never the caller's.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-verified-user-id', userId ?? '')
  const finalResponse = NextResponse.next({ request: { headers: requestHeaders } })
  // Carry forward any session-refresh cookies getClaims() queued via setAll()
  // above — without this, replacing supabaseResponse here would silently drop
  // the refreshed auth cookie and the browser would never receive it.
  supabaseResponse.cookies.getAll().forEach((c) => finalResponse.cookies.set(c))
  return finalResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
