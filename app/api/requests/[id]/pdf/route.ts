import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { getRequestById, getRequestActivity, getRequestComments, getCsatSurveyForRequest } from '@/lib/queries/requests'
import { getRequestAttachments } from '@/lib/queries/attachments'
import { getApprovalsForRequest } from '@/lib/queries/approvals'
import { buildTicketPdfModel, ticketPdfFileName } from '@/lib/requests/ticket-pdf-model'
import { renderTicketPdf } from '@/lib/pdf/ticket-pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// The ticket as a PDF: its details, what the requester submitted and the whole conversation (never internal notes).
// Everything is read with the signed-in person's own session, so they can only download a ticket they can open.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'not signed in' }, { status: 401 })

  const request = await getRequestById(id)
  if (!request) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const [comments, activity, attachments, approvals, csat] = await Promise.all([
    getRequestComments(id),
    getRequestActivity(id),
    getRequestAttachments(id),
    getApprovalsForRequest(id),
    getCsatSurveyForRequest(id),
  ])

  const isAgent =
    profile.role === 'manager' ||
    profile.role === 'admin' ||
    profile.role === 'platform_owner' ||
    (profile.role === 'agent' && profile.team_members.some((m) => m.team_id === request.team_id))

  const model = buildTicketPdfModel({
    request, comments, activity, attachments,
    approvals: approvals as never,
    csat,
    viewer: { name: profile.full_name, isAgent },
  })

  let pdf: Buffer
  try {
    pdf = await renderTicketPdf(model)
  } catch (e) {
    console.error('[ticket-pdf] render failed', e)
    return NextResponse.json({ error: 'Could not create the PDF.' }, { status: 500 })
  }

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${ticketPdfFileName(request.request_no)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
