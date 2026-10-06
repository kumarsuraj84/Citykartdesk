import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// The version stamp of the build this server is running. Open pages compare it with the one they
// were loaded with (components/layout/NewVersionBanner.tsx) to prompt for a refresh after a
// deployment. Public on purpose: it exposes nothing but an opaque build stamp.
export function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
