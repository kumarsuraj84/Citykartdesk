import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { syncInboundReplies } from '@/lib/email/inbound'

// GET /api/email/inbound-sync — called on a schedule by scripts/cron-tick.mjs (job name
// "email-reply-sync"), the same way alerts/business-rules already are. Polls the
// configured mailbox for replies to our own outbound ticket emails and adds each one to
// that ticket's conversation. See lib/email/inbound.ts.
export async function GET(req: NextRequest) {
  const verified = verifyCronSecret(req)
  if (verified === null) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured.' }, { status: 503 })
  }
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await syncInboundReplies()
  return NextResponse.json({ ok: result.errors.length === 0, ...result })
}
