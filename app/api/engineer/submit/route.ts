import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkEngineerAccess } from '@/lib/visits/access'
import { submitEngineerReport, type EngineerFile, type EngineerItemInput } from '@/lib/visits/submit'
import { MAX_FSR_BYTES, MAX_FSR_FILES } from '@/lib/visits/constants'
import { validateAttachmentServer } from '@/lib/attachments/validate-server'
import { getSecret } from '@/lib/secrets'
import { rateLimit } from '@/lib/rate-limit'

// POST /api/engineer/submit  (multipart: storeCode, code, name, mobile, visitDate, items (JSON), fsr (files))
// Public (no sign-in). The same store code + visit code check as the lookup, then the engineer's report is saved against the open tickets of the ACs he names.
const MAX_BODY = 60 * 1024 * 1024
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])

export async function POST(req: Request) {
  if (!getSecret('visit_code')) return NextResponse.json({ error: 'The engineer visit page is not switched on yet.' }, { status: 503 })
  const declared = Number(req.headers.get('content-length') ?? NaN)
  if (!Number.isFinite(declared) || declared > MAX_BODY) return NextResponse.json({ error: 'The photos are too large. Please send smaller photos.' }, { status: 413 })
  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'The form could not be read. Please try again.' }, { status: 400 }) }

  const access = await checkEngineerAccess(form.get('storeCode'), form.get('code'))
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if ((await rateLimit(`visit-submit:${access.storeCode}`, 20, 60 * 60_000)).limited) return NextResponse.json({ error: 'Too many reports for this store in the last hour. Please try again later.' }, { status: 429 })

  let items: EngineerItemInput[]
  try { items = JSON.parse(String(form.get('items') ?? '[]')) } catch { return NextResponse.json({ error: 'The ACs could not be read. Please try again.' }, { status: 400 }) }
  if (!Array.isArray(items) || items.length > 40) return NextResponse.json({ error: 'Please choose the ACs again.' }, { status: 400 })

  const files: EngineerFile[] = []
  const uploaded = form.getAll('fsr').filter((f): f is File => f instanceof File && f.size > 0)
  if (uploaded.length > MAX_FSR_FILES) return NextResponse.json({ error: `At most ${MAX_FSR_FILES} photos can be sent.` }, { status: 400 })
  for (const f of uploaded) {
    if (f.size > MAX_FSR_BYTES) return NextResponse.json({ error: `"${f.name}" is larger than ${MAX_FSR_BYTES / 1024 / 1024} MB.` }, { status: 400 })
    if (!ALLOWED.has(f.type)) return NextResponse.json({ error: `"${f.name}": only photos (JPG, PNG) and PDF files can be sent.` }, { status: 400 })
    const check = await validateAttachmentServer(f)
    if (!check.valid) return NextResponse.json({ error: `"${f.name}": ${check.error ?? 'this file cannot be accepted.'}` }, { status: 400 })
    files.push({ name: f.name, mimeType: f.type, bytes: Buffer.from(await f.arrayBuffer()) })
  }

  const result = await submitEngineerReport(createAdminClient(), {
    orgId: access.orgId, storeCode: access.storeCode,
    engineerName: String(form.get('name') ?? ''), engineerMobile: String(form.get('mobile') ?? ''), visitDate: String(form.get('visitDate') ?? ''),
    items, files,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, items: result.items })
}
