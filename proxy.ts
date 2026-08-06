import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Map route prefixes to the module slug required to access them
const MODULE_ROUTES: [string, string][] = [
  ['/requests',  'requests'],
  ['/services',  'services'],
  ['/tasks',     'tasks'],
  ['/approvals', 'approvals'],
  ['/intake',    'intake'],
]

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
    pathname.startsWith('/signup') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/reset-password') ||
    pathname === '/' ||
    pathname.startsWith('/legal') ||
    pathname.startsWith('/demo')

  if (!userId && !isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
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
  if (userId && (pathname === '/' || pathname.startsWith('/signup'))) {
    const url = request.nextUrl.clone()
    url.pathname = '/home'
    return NextResponse.redirect(url)
  }

  // ── Module gating ──────────────────────────────────────────
  if (userId) {
    const matched = MODULE_ROUTES.find(([prefix]) => pathname.startsWith(prefix))
    if (matched) {
      const [, requiredModule] = matched

      // Fast path: single RPC resolves org + module access in one round-trip.
      let isEnabled: boolean | null = null
      const { data: rpcResult, error: rpcError } = await supabase.rpc('has_module_access', {
        p_module: requiredModule,
      })
      if (!rpcError) {
        isEnabled = rpcResult === true
      } else {
        // Fallback (e.g. migration 051 not yet applied): legacy two-query path.
        const { data: profile } = await supabase
          .from('profiles')
          .select('org_id')
          .eq('id', userId)
          .single()

        if (!profile?.org_id) {
          isEnabled = true // org-less users pass through, matching prior behaviour
        } else {
          const adminClient = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { cookies: { getAll: () => [], setAll: () => {} } }
          )
          const { data: access } = await adminClient
            .from('org_module_access')
            .select('enabled, valid_until')
            .eq('org_id', profile.org_id)
            .eq('module', requiredModule)
            .maybeSingle()

          const now = new Date().toISOString()
          isEnabled =
            access?.enabled === true &&
            (access.valid_until === null || access.valid_until > now)
        }
      }

      if (!isEnabled) {
        const url = request.nextUrl.clone()
        url.pathname = '/home'
        return NextResponse.redirect(url)
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
