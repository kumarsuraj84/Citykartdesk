import { NextResponse } from 'next/server'
import { currentBuild } from '@/lib/http/build-info'

export const dynamic = 'force-dynamic'

// The version stamp of the build this server is running. Open pages compare it with the one they
// were loaded with (components/layout/NewVersionBanner.tsx) to prompt for a refresh after a
// deployment. Public on purpose: it exposes nothing but an opaque build stamp (and the short commit
// hash inside it, when the build was made by scripts/windows/build-for-deploy.ps1).
export function GET() {
  return NextResponse.json(
    currentBuild(),
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
