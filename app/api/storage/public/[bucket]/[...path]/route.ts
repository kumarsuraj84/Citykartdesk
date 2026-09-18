import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// DESK-STORAGE-001: every Storage URL used to be built via getPublicUrl()/
// createSignedUrl(), which returns an ABSOLUTE URL rooted at
// NEXT_PUBLIC_SUPABASE_URL — inlined into every bundle at build time (Next.js
// does literal string replacement for NEXT_PUBLIC_* vars everywhere, not just
// client components). That URL was http://10.0.1.12:8443 (Main's LAN address),
// so any browser reaching the app via its port-forwarded public IP
// (http://182.72.84.10:3210) got an <img src> pointing at a private address
// it has no route to — the icon/avatar/attachment request never even leaves
// the browser's network stack.
//
// Fix: never hand the browser an absolute Storage host at all. Every image/
// attachment URL in the app is now a path relative to whatever origin the
// browser is already using (this route, or the two below it), which this
// server resolves internally via the admin client — a same-machine call,
// unaffected by which external IP/hostname the browser came in on.
//
// This route serves the two PUBLIC buckets only (icons, avatars) — no auth
// required, matching the buckets' own public-read Storage policy that
// getPublicUrl() relied on. Attachments (private, RLS-gated) are served by
// the two routes under app/api/storage/attachment/ instead, which check
// access before streaming anything.
const PUBLIC_BUCKETS = new Set(['icons', 'avatars'])

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bucket: string; path: string[] }> }
) {
  const { bucket, path } = await params
  if (!PUBLIC_BUCKETS.has(bucket)) {
    return NextResponse.json({ error: 'unknown bucket' }, { status: 404 })
  }
  const storagePath = path.join('/')

  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(bucket).download(storagePath)
  if (error || !data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  // icons/<uuid>.<ext> paths are content-addressed (a fresh random uuid every
  // upload — see uploadIconImage() — the old file is simply abandoned, never
  // overwritten), so caching forever is safe. avatars/<userId>/avatar.<ext>
  // is a FIXED path re-uploaded in place (see uploadAvatar()) — long/immutable
  // caching there would keep serving someone's old photo after they change
  // it, so it gets a short cache instead.
  const cacheControl = bucket === 'icons'
    ? 'public, max-age=31536000, immutable'
    : 'public, max-age=60'

  return new NextResponse(data, {
    headers: {
      'Content-Type': data.type || 'application/octet-stream',
      'Cache-Control': cacheControl,
    },
  })
}
