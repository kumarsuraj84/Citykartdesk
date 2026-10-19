import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkEngineerAccess } from '@/lib/visits/access'
import { loadOpenAcIssues } from '@/lib/visits/issues'
import { getSecret } from '@/lib/secrets'

// POST /api/engineer/lookup  { storeCode, code }
// Public (no sign-in). The OEM engineer proves he is at the store with the store code and the store's visit code of the day, and gets the store's open AC issues.
// Shows only what the engineer needs: AC number and details, and the ticket numbers / subjects. No requester or contact details.
export async function POST(req: Request) {
  if (!getSecret('visit_code')) return NextResponse.json({ error: 'The engineer visit page is not switched on yet.' }, { status: 503 })
  let body: { storeCode?: unknown; code?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Please enter the store code and the visit code.' }, { status: 400 }) }
  const access = await checkEngineerAccess(body.storeCode, body.code)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const issues = await loadOpenAcIssues(createAdminClient() as never, access.orgId, access.storeCode)
  return NextResponse.json({
    store: { code: access.storeCode, name: access.storeName },
    issues: issues.map((i) => ({
      unitId: i.unitId, ckdeskNo: i.ckdeskNo, details: i.details,
      tickets: i.tickets.map((t) => ({ requestNo: t.requestNo, title: t.title, loggedOn: t.createdAt.slice(0, 10) })),
    })),
  })
}
