import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { isVendor } from '@/lib/vendor/access'
import { buildPoWorkbook, filterPoRows, loadPoRegister } from '@/lib/vendor/register'
import { rateLimit } from '@/lib/rate-limit'

// Excel download of the PO register (the filters of the screen apply). A vendor gets his own POs (a vendor manager: his company's); Citykart's technicians, managers
// and administrators get all of them. Anybody else gets nothing.
const STAFF = ['agent', 'manager', 'admin', 'platform_owner']

export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile || !profile.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const vendor = isVendor(profile)
  if (!vendor && !STAFF.includes(profile.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { limited } = await rateLimit(`po-export:${profile.id}`, 20, 60_000)
  if (limited) return NextResponse.json({ error: 'Too many downloads. Please wait a minute.' }, { status: 429 })

  const sp = req.nextUrl.searchParams
  const rows = filterPoRows(await loadPoRegister(vendor ? { kind: 'vendor' } : { kind: 'staff', orgId: profile.org_id }), {
    q: sp.get('q') ?? undefined, status: sp.get('status') ?? undefined, from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined,
  })
  const file = await buildPoWorkbook(rows, `Exported ${new Date().toISOString().slice(0, 10)} by ${profile.full_name}`)
  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="purchase-orders-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
