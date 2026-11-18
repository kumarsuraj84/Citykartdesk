import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { sanitizeRum } from '@/lib/health/rum'

export const dynamic = 'force-dynamic'

// POST /api/rum   one small report from a signed-in person's browser: how fast the screen came up and whether its content fitted the window
// (components/layout/RumReporter.tsx). Needs a session (the proxy already refuses a call with none); the person is NOT stored, only the numbers, the screen (ids removed)
// and the window width. Always answers 204 for a well-formed call so the browser never retries; a bad or too frequent call is dropped quietly.
// Read by platform owners only, on the Health & Performance page. Switched off with RUM_ENABLED=0.
const MAX_BODY = 1500

export async function POST(req: NextRequest) {
  if (process.env.RUM_ENABLED === '0') return new NextResponse(null, { status: 204 })
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return new NextResponse(null, { status: 403 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse(null, { status: 401 })
  if ((await rateLimit(`rum:${user.id}`, 120, 60_000)).limited) return new NextResponse(null, { status: 204 })

  let row = null
  try {
    const text = await req.text()
    if (text.length <= MAX_BODY) row = sanitizeRum(JSON.parse(text))
  } catch { /* not JSON: dropped */ }
  if (!row) return new NextResponse(null, { status: 204 })
  try {
    await (createAdminClient() as unknown as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } }).from('rum_samples').insert(row)
  } catch { /* a report is a bonus: never an error for the person */ }
  return new NextResponse(null, { status: 204 })
}
