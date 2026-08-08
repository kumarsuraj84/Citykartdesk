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

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
