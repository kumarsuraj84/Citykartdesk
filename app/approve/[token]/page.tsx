import { cookies } from 'next/headers'
import { CheckCircle2, Clock, Link2Off, ShieldAlert, XCircle } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentProfile } from '@/lib/queries/profiles'
import { describeApprovalLink } from '@/lib/approvals/email-state'
import { isVerified, notAuthorisedMessage, verifiedCookieName, verifyApprovalToken } from '@/lib/approvals/email-link'
import { ApprovalDecisionForm } from './ApprovalDecisionForm'
import { ApprovalGate } from './ApprovalGate'

export const metadata = { title: 'Approve or reject', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-xl space-y-5">
        <p className="text-center text-sm font-semibold tracking-tight text-muted-foreground">Citykart Desk</p>
        <div className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">{children}</div>
      </div>
    </div>
  )
}

function Notice({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-2 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">{icon}</div>
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {children && <div className="space-y-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  )
}

const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? 'the approver') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

export default async function ApprovePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { token } = await params
  const sp = await searchParams
  const v = verifyApprovalToken(token)
  if (!v) {
    return <Shell><Notice icon={<Link2Off className="h-6 w-6 text-muted-foreground" />} title="This link is not valid">Please use the buttons in the latest e-mail we sent you, or open the request in Citykart Desk.</Notice></Shell>
  }

  const state = await describeApprovalLink(createAdminClient(), v.approvalId, v.approverId)
  if (state.kind === 'invalid') {
    return <Shell><Notice icon={<Link2Off className="h-6 w-6 text-muted-foreground" />} title="This link is not valid">The approval could not be found.</Notice></Shell>
  }

  const heading = <p className="text-center font-mono text-xs text-muted-foreground">{state.requestNo}</p>
  const sentLine = <p>This request was sent for approval to <strong className="text-foreground">{list(state.sentTo)}</strong>.</p>

  if (state.kind === 'decided') {
    const approved = state.outcome === 'approved'
    return (
      <Shell>
        {heading}
        <Notice icon={approved ? <CheckCircle2 className="h-6 w-6 text-emerald-600" /> : <XCircle className="h-6 w-6 text-red-600" />} title={`${state.title}`}>
          {sentLine}
          <p>This request was <strong className="text-foreground">{approved ? 'approved' : 'rejected'}</strong> by <strong className="text-foreground">{state.by}</strong> on {state.at}. Nothing more is needed from anyone.</p>
        </Notice>
      </Shell>
    )
  }
  if (state.kind === 'closed') {
    return <Shell>{heading}<Notice icon={<Clock className="h-6 w-6 text-muted-foreground" />} title={state.title}>{sentLine}<p>This request is no longer waiting for approval.</p></Notice></Shell>
  }
  if (state.kind === 'already_by_you') {
    return <Shell>{heading}<Notice icon={<CheckCircle2 className="h-6 w-6 text-emerald-600" />} title={state.title}>{sentLine}<p>{state.approverName} already responded on {state.at}. The request is moving along.</p></Notice></Shell>
  }
  if (state.kind === 'not_current') {
    return (
      <Shell>
        {heading}
        <Notice icon={<Clock className="h-6 w-6 text-muted-foreground" />} title="No decision needed from you right now">
          {sentLine}
          <p>It is currently waiting on <strong className="text-foreground">{list(state.waitingOn)}</strong>.</p>
        </Notice>
      </Shell>
    )
  }

  // pending, and this link's approver is one of the people who can decide. Who is looking at the page?
  const viewer = await getCurrentProfile()
  const proof = (await cookies()).get(verifiedCookieName(v.approvalId))?.value
  const isApprover = viewer?.id === v.approverId || isVerified(proof, v.approvalId, v.approverId)

  if (!isApprover && viewer) {
    return (
      <Shell>
        {heading}
        <Notice icon={<ShieldAlert className="h-6 w-6 text-red-600" />} title="You are not authorised">
          <p>{notAuthorisedMessage(state.approverName)}</p>
        </Notice>
      </Shell>
    )
  }
  if (!isApprover) {
    return (
      <Shell>
        {heading}
        <ApprovalGate token={token} approverName={state.approverName} requestNo={state.requestNo} signInHref={`/login?next=${encodeURIComponent(`/approve/${token}`)}`} />
      </Shell>
    )
  }

  const d = state.detail
  return (
    <Shell>
      {heading}
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{state.title}</h1>
        <p className="text-sm text-muted-foreground">Deciding as <strong className="text-foreground">{state.approverName}</strong></p>
      </div>
      <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/20 p-3 text-xs">
        <dt className="text-muted-foreground">Raised by</dt><dd className="font-medium">{d.requesterName || '-'}</dd>
        {d.sentByName && <><dt className="text-muted-foreground">Sent for approval by</dt><dd className="font-medium">{d.sentByName}</dd></>}
        <dt className="text-muted-foreground">Priority</dt><dd className="font-medium capitalize">{d.priority}</dd>
        {d.service && <><dt className="text-muted-foreground">Service</dt><dd className="font-medium">{d.service}</dd></>}
        {d.category && <><dt className="text-muted-foreground">Category</dt><dd className="font-medium">{d.category}</dd></>}
        <dt className="text-muted-foreground">Created</dt><dd className="font-medium">{d.created}</dd>
        <dt className="text-muted-foreground">Sent to</dt><dd className="font-medium">{list(state.sentTo)}</dd>
      </dl>
      {d.description && <p className="whitespace-pre-wrap text-sm">{d.description}</p>}
      {d.conversation.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversation</p>
          {d.conversation.map((c, i) => (
            <div key={i} className="rounded-lg border border-border px-3 py-2 text-xs">
              <p className="font-medium">{c.author} <span className="font-normal text-muted-foreground">- {c.at}</span></p>
              <p className="mt-0.5 whitespace-pre-wrap text-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      )}
      <ApprovalDecisionForm token={token} preselect={sp.do === 'approve' || sp.do === 'reject' ? sp.do : null} />
    </Shell>
  )
}
